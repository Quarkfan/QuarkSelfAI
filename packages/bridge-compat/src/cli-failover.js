import { randomUUID } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "./util.js";

const INFRASTRUCTURE_ERROR = /(timed? out|timeout|temporar|reconnect|connection|network|transport|websocket|dns|no such host|econn|socket|rate.?limit|too many requests|401 unauthorized|incorrect api key|429|502|503|504|enoent|failed to connect|service unavailable)/i;

export function isCodexInfrastructureFailure(value) {
  if (value?.timedOut) return true;
  const detail = typeof value === "string"
    ? value
    : `${value?.message || ""}\n${value?.stderr || ""}\n${value?.stdout || ""}`;
  return INFRASTRUCTURE_ERROR.test(detail);
}

export function codexEnvironment(config, source = process.env) {
  const environment = { ...source };
  if (config.codexUseChatgptAuth !== false) delete environment.OPENAI_API_KEY;
  return environment;
}

function claudeEnvironment(config, source = process.env) {
  const environment = { ...source };
  if (config.claudeUseSubscriptionAuth !== false) delete environment.ANTHROPIC_API_KEY;
  return environment;
}

function argumentValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function didaTools(args) {
  const setting = args.find((argument) => String(argument).startsWith("mcp_servers.dida365.enabled_tools="));
  if (!setting) return [];
  try { return JSON.parse(setting.slice(setting.indexOf("=") + 1)); }
  catch { return []; }
}

async function didaCliToken(config) {
  const configPath = config.didaCliConfigPath
    || path.join(os.homedir(), ".config", "dida-cli", "config.json");
  let info;
  try { info = await stat(configPath); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`dida CLI 凭证文件权限过宽：${configPath}，需要 chmod 600`);
  }
  const stored = JSON.parse(await readFile(configPath, "utf8"));
  return typeof stored.access_token === "string" && stored.access_token.length >= 10
    ? stored.access_token
    : null;
}

function claudeMcpConfig(config, tokenEnvVar) {
  const mcpConfig = structuredClone(config.claudeDidaMcpConfig || {
    mcpServers: { dida365: { type: "http", url: "https://mcp.dida365.com" } },
  });
  const didaServer = mcpConfig.mcpServers?.dida365;
  if (didaServer && tokenEnvVar) {
    didaServer.headers = {
      ...didaServer.headers,
      Authorization: `Bearer \${${tokenEnvVar}}`,
    };
  }
  return JSON.stringify(mcpConfig);
}

function parseClaudeJson(stdout) {
  const envelope = JSON.parse(stdout.trim());
  if (envelope.is_error || String(envelope.subtype || "").startsWith("error")) {
    const detail = Array.isArray(envelope.errors) ? envelope.errors.join("; ") : envelope.terminal_reason;
    throw new Error(detail || "Claude Code 返回执行错误");
  }
  return {
    final: String(envelope.result || envelope.text || "").trim(),
    sessionId: envelope.session_id || envelope.sessionId || null,
    structured: envelope.structured_output ?? envelope.structuredOutput ?? null,
  };
}

async function runClaudeStructured(config, codexArgs, options, token = null) {
  const schemaPath = argumentValue(codexArgs, "--output-schema");
  const outputPath = argumentValue(codexArgs, "-o");
  if (!schemaPath || !outputPath) throw new Error("Claude 兜底缺少结构化输出 schema 或输出路径");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const tools = didaTools(codexArgs).map((tool) => `mcp__dida365__${tool}`);
  const tokenEnvVar = token ? (config.didaTokenEnvVar || "DIDA365_TOKEN") : null;
  const args = [
    "-p", "--output-format", "json", "--json-schema", JSON.stringify(schema),
    "--permission-mode", "dontAsk", "--mcp-config", claudeMcpConfig(config, tokenEnvVar), "--strict-mcp-config",
  ];
  if (tools.length) args.push("--allowedTools", tools.join(","));
  if (config.claudeModel) args.push("--model", config.claudeModel);
  const environment = claudeEnvironment(config, options.env);
  if (tokenEnvVar) environment[tokenEnvVar] = token;
  const result = await run(config.claudeCli, args, {
    ...options,
    env: environment,
    timeoutMs: config.claudeExecutionTimeoutMs || options.timeoutMs,
  });
  if (result.code !== 0 || result.timedOut) return { ...result, provider: "claude", fallbackAttempted: true };
  try {
    const output = parseClaudeJson(result.stdout);
    if (!output.structured) throw new Error("Claude 未返回 structured_output");
    await writeFile(outputPath, `${JSON.stringify(output.structured, null, 2)}\n`, { mode: 0o600 });
    return { ...result, code: 0, provider: "claude", fallbackAttempted: true };
  } catch (error) {
    return { ...result, code: 1, stderr: `Claude 结构化输出无效：${error.message}\n${result.stderr}`, provider: "claude", fallbackAttempted: true };
  }
}

export async function runCodexWithClaudeFallback(config, codexArgs, options = {}) {
  const usesDida = didaTools(codexArgs).length > 0;
  const token = usesDida ? await didaCliToken(config) : null;
  const tokenEnvVar = token ? (config.didaTokenEnvVar || "DIDA365_TOKEN") : null;
  const effectiveCodexArgs = tokenEnvVar
    ? [codexArgs[0], "-c", `mcp_servers.dida365.bearer_token_env_var=\"${tokenEnvVar}\"`, ...codexArgs.slice(1)]
    : codexArgs;
  const environment = codexEnvironment(config, options.env);
  if (tokenEnvVar) environment[tokenEnvVar] = token;
  const executeCodex = async () => {
    try {
      return await run(config.codexCli, effectiveCodexArgs, {
        ...options,
        env: environment,
      });
    } catch (error) {
      return { code: 1, signal: null, stdout: "", stderr: error.message, timedOut: false };
    }
  };

  if (usesDida && config.didaPrimaryProvider === "claude") {
    let claudeResult;
    try {
      if (!token) throw new Error("dida CLI 尚未登录，Claude Code 无法复用滴答授权");
      claudeResult = await runClaudeStructured(config, codexArgs, options, token);
    } catch (error) {
      claudeResult = {
        code: 1,
        signal: null,
        stdout: "",
        stderr: error.message,
        timedOut: false,
        provider: "claude",
      };
    }
    if (claudeResult.code === 0 && !claudeResult.timedOut) {
      return { ...claudeResult, fallbackAttempted: undefined, primaryProvider: "claude" };
    }
    const codexFallback = await executeCodex();
    if (codexFallback.code === 0 && !codexFallback.timedOut) {
      return { ...codexFallback, provider: "codex", fallbackAttempted: true, primaryProvider: "claude" };
    }
    return {
      ...codexFallback,
      provider: "codex",
      fallbackAttempted: true,
      primaryProvider: "claude",
      stderr: `Claude Code 主执行失败：${String(claudeResult.stderr || claudeResult.stdout || "").trim().slice(-1500)}\nCodex 兜底失败：${String(codexFallback.stderr || codexFallback.stdout || "").trim().slice(-1500)}`,
    };
  }

  let codexResult;
  codexResult = await executeCodex();
  if (codexResult.code === 0 || config.claudeFallbackEnabled === false || !isCodexInfrastructureFailure(codexResult)) {
    return { ...codexResult, provider: "codex" };
  }
  try {
    if (usesDida && !token) {
      throw new Error("dida CLI 尚未登录，Claude Code 无法复用滴答授权");
    }
    return await runClaudeStructured(config, codexArgs, options, token);
  } catch (error) {
    return {
      code: 1,
      signal: null,
      stdout: "",
      stderr: `Codex 不可用：${(codexResult.stderr || codexResult.stdout).trim().slice(-1500)}\nClaude Code 兜底启动失败：${error.message}`,
      timedOut: false,
      provider: "claude",
      fallbackAttempted: true,
    };
  }
}

async function findTranscript(directory, sessionId, depth = 0) {
  if (depth > 5) return null;
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return null; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
      return path.join(directory, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findTranscript(path.join(directory, entry.name), sessionId, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function runClaudeSession(config, job, prompt, options = {}) {
  const existingClaudeSession = job.executor === "claude" && job.claudeSessionId;
  const claudeSessionId = job.claudeSessionId || randomUUID();
  job.executor = "claude";
  job.claudeSessionId = claudeSessionId;
  const transcript = job.sessionId && !String(job.sessionId).startsWith("claude:")
    ? await findTranscript(path.join(config.codexHome, "sessions"), job.sessionId)
    : null;
  const context = transcript
    ? `Codex 原会话记录位于 ${transcript}。先读取其中最近的相关用户要求、已完成工作和未决事项，再继续执行；不要修改该记录文件。`
    : "当前无法读取原 Codex 会话记录，请依据本条要求和工作区现状谨慎继续。";
  const fullPrompt = `${context}\n\n${prompt}`;
  const args = ["-p", "--output-format", "json", "--permission-mode", options.readOnly ? "plan" : "auto"];
  if (existingClaudeSession) args.push("--resume", claudeSessionId);
  else args.push("--session-id", claudeSessionId);
  if (transcript) args.push("--add-dir", path.dirname(transcript));
  if (config.claudeModel) args.push("--model", config.claudeModel);
  const result = await run(config.claudeCli, args, {
    cwd: config.workspaceRoot,
    input: fullPrompt,
    env: claudeEnvironment(config),
    timeoutMs: options.timeoutMs,
    onSpawn: options.onSpawn,
  });
  if (result.timedOut) throw new Error("Claude Code 执行超时，任务已保留并将续接重试。");
  if (result.code !== 0) throw new Error(`Claude Code 执行失败（exit ${result.code}）：\n${(result.stderr || result.stdout).trim().slice(-4000)}`);
  const output = parseClaudeJson(result.stdout);
  return { final: output.final || "任务已执行完成，但 Claude Code 未返回最终文本。", sessionId: claudeSessionId, provider: "claude" };
}
