import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, shortId } from "./util.js";
import { createVisibleThread } from "./codex-app-server-client.js";
import { codexEnvironment, ExecutorFailure, isCodexInfrastructureFailure, runClaudeSession, runDshSession } from "./cli-failover.js";

const SAFETY_CONTEXT = `

[来自飞书的远程指令]
这是用户本人通过飞书发送到当前 Codex 会话的要求。请延续当前会话上下文执行。
如果操作涉及 git push、部署、DDL/数据库写入、删除数据或文件、向外部人员发送消息，而本条指令没有明确授权该具体动作，请不要执行；请在最终回复中以“需要确认：”开头，列出动作、目标和影响，等待用户下一条飞书确认。
如果推进任务确实需要用户补充信息、授权、账号操作或业务决定，请遵循 /Users/edy/BlackLakeWork/AGENTS.md，使用 ask-human-via-lark skill 联系常东旭并长时间等待回复；收到后继续当前 session。不要因为用户未立即回复就结束任务。
完成后给出自包含的最终结论，清楚区分已完成、验证结果、未完成和需要确认的事项。
`;

const CONTROLLER_CONTEXT = `

[飞书总控职责]
你正在充当常东旭的飞书总控。请直接理解并执行他的自然语言要求，不要先把要求归类成固定枚举，也不要要求他输入命令。
普通要求就在当前任务中处理。只有当他明确指定另一个 Codex 任务，或明确要求创建新任务时，才使用 codex_bridge MCP：
- codex_bridge_list_sessions：查找本机已有任务；不确定目标时先查，不要猜 ID。
- codex_bridge_send_to_session：把要求交给指定任务并等待结果，然后将结果汇总给常东旭。
- codex_bridge_create_session：创建左侧栏可见的新任务并执行首条要求。
- codex_bridge_get_status：查看桥接器排队和运行状态。
- quark_policy_propose：当常东旭用自然语言要求新增或调整长期策略时，生成受限 PolicyDocument 并提交本地验证、样本模拟和草案保存。不得把规则只留在聊天回复中。
- quark_policy_activate：仅在常东旭针对具体 policy ID/revision 明确批准后激活；原始策略要求不等于激活批准。
- quark_work_journal_query：当常东旭要求日报、周报、月报、季度复盘或任意日期范围工作总结时，先读取每日工作账本。账本缺少尚未闭账的当天或历史日期时，再从飞书、日历、滴答、Jira、GitLab、本地 Git 和执行会话做只读补齐，并在结论中说明覆盖范围与证据缺口。
会话工具是执行能力，不是输出格式。不要为了普通工作额外创建任务。不得通过这些工具绕过外部回复、发布、删除、数据库写入等确认门禁。
`;

export function buildConversationContinuityContext(conversationContext) {
  if (!conversationContext) return "";
  const previous = (conversationContext.previousMessages || []).slice(-6).map((message) => ({
    messageId: message.messageId,
    content: String(message.content || "").slice(0, 800),
    role: message.role === "assistant" ? "assistant" : "owner",
    receivedAt: message.receivedAt || null,
    replyTo: message.replyTo || null,
    rootId: message.rootId || null,
    threadId: message.threadId || null,
  }));
  const current = conversationContext.currentMessage || {};
  const proactive = conversationContext.proactiveQuestion;
  return `

[飞书私聊上下文连贯性]
请判断当前消息是否在继续、修正、确认或补充前文。优先使用 replyTo、rootId、threadId 的明确关联，其次使用时间邻近且主题相容的前文；不要把无关事项强行串联，也不要从含糊短句推断高影响操作的批准。当前消息仍是唯一待执行要求，以下历史只用于消歧。
当前消息元数据：${JSON.stringify({ messageId: current.messageId, replyTo: current.replyTo || null, rootId: current.rootId || null, threadId: current.threadId || null })}
最近本人私聊：${JSON.stringify(previous)}
${proactive ? `当前消息明确回复了助手先前主动提出的问题：${JSON.stringify(proactive)}。优先把它理解为可沉淀、可被后续纠正的本人信息；除非回答本身明确要求执行某个动作，否则不要把它扩张成新的执行授权。` : ""}
`;
}

function shanghaiTimestamp(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}-${value.hour}${value.minute}${value.second}-${String(now.getMilliseconds()).padStart(3, "0")}`;
}

export function buildUniqueSessionTitle(baseTitle, requestId, now = new Date()) {
  const marker = createHash("sha256").update(String(requestId || now.getTime())).digest("hex").slice(0, 6).toUpperCase();
  const prefix = `【AI创建·${shanghaiTimestamp(now)}·${marker}】`;
  const readable = String(baseTitle || "未命名任务")
    .replace(/^【AI创建·[^】]+】/, "")
    .replace(/\s+/g, " ")
    .trim() || "未命名任务";
  return `${prefix}${readable.slice(0, Math.max(1, 80 - prefix.length))}`;
}

export class SessionBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionBusyError";
  }
}

export class CodexRunner {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.running = new Map();
  }

  isRunning(sessionId) {
    return this.running.has(sessionId);
  }

  async execute(job, onProgress = async () => {}) {
    const runDir = path.join(this.config.varDir, "runs", `${Date.now()}-${shortId(job.sessionId)}`);
    await mkdir(runDir, { recursive: true });
    const finalPath = path.join(runDir, "final.md");
    const prompt = `${job.prompt}${buildConversationContinuityContext(job.conversationContext)}${SAFETY_CONTEXT}${job.controller ? CONTROLLER_CONTEXT : ""}`;
    const allowDshFallback = job.controller === true && this.config.dshFallbackEnabled !== false;
    if (job.executor === "dsh-native") {
      try {
        const result = await runDshSession(this.config, job, prompt, {
          timeoutMs: this.config.dshSessionTimeoutMs || 20 * 60_000,
          onSpawn: (child) => this.running.set(job.sessionId, child),
        });
        return result.final;
      } finally {
        this.running.delete(job.sessionId);
      }
    }
    if (job.executor === "claude") {
      try {
        const result = await runClaudeSession(this.config, job, prompt, {
          timeoutMs: this.config.claudeSessionTimeoutMs || 20 * 60_000,
          onSpawn: (child) => this.running.set(job.sessionId, child),
        });
        return result.final;
      } catch (error) {
        if (!allowDshFallback || !isCodexInfrastructureFailure(error)) throw error;
        const fallback = await runDshSession(this.config, job, prompt, {
          timeoutMs: this.config.dshSessionTimeoutMs || 20 * 60_000,
          onSpawn: (child) => this.running.set(job.sessionId, child),
        });
        return fallback.final;
      } finally {
        this.running.delete(job.sessionId);
      }
    }
    let jsonBuffer = "";
    let lastProgressAt = 0;
    const emitProgress = async (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === "item.started" && event.item?.type === "command_execution") {
          const now = Date.now();
          if (now - lastProgressAt >= this.config.progressIntervalMs) {
            lastProgressAt = now;
            await onProgress("正在执行并验证，请稍候……");
          }
        }
      } catch {
        // Non-JSON diagnostics are retained by run() and summarized on failure.
      }
    };

    const args = ["exec"];
    if (job.controller && this.config.bridgeControlMcpEnabled !== false) {
      const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "codex-bridge-mcp.js");
      args.push(
        "-c", "mcp_servers.github.enabled=false",
        "-c", "mcp_servers.slack.enabled=false",
        "-c", `mcp_servers.codex_bridge.command=${JSON.stringify(process.execPath)}`,
        "-c", `mcp_servers.codex_bridge.args=${JSON.stringify([serverPath])}`,
        "-c", "mcp_servers.codex_bridge.startup_timeout_sec=10",
        "-c", "mcp_servers.codex_bridge.tool_timeout_sec=1200",
      );
    }
    args.push("resume", "--all", "--skip-git-repo-check", "--json", "-o", finalPath, job.sessionId, "-");
    const execution = run(this.config.codexCli, args, {
      cwd: this.config.workspaceRoot,
      input: prompt,
      env: codexEnvironment(this.config),
      onSpawn: (child) => this.running.set(job.sessionId, child),
      onStdout: (data) => {
        jsonBuffer += data;
        const lines = jsonBuffer.split("\n");
        jsonBuffer = lines.pop() ?? "";
        for (const line of lines) void emitProgress(line);
      },
    });
    const result = await execution;
    this.running.delete(job.sessionId);

    let final = "";
    try { final = (await readFile(finalPath, "utf8")).trim(); } catch {}
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(-4000);
      if (/writer.*lock|thread.*lock|already.*running|session.*busy|resource busy/i.test(detail)) {
        throw new SessionBusyError(detail);
      }
      if (isCodexInfrastructureFailure(result)) {
        let fallbackError = null;
        if (this.config.claudeFallbackEnabled !== false) {
          try {
            const fallback = await runClaudeSession(this.config, job, prompt, {
              timeoutMs: this.config.claudeSessionTimeoutMs || 20 * 60_000,
              onSpawn: (child) => this.running.set(job.sessionId, child),
            });
            return fallback.final;
          } catch (error) {
            fallbackError = error;
          } finally {
            this.running.delete(job.sessionId);
          }
        }
        if (allowDshFallback && (!fallbackError || isCodexInfrastructureFailure(fallbackError))) {
          try {
            const fallback = await runDshSession(this.config, job, prompt, {
              timeoutMs: this.config.dshSessionTimeoutMs || 20 * 60_000,
              onSpawn: (child) => this.running.set(job.sessionId, child),
            });
            return fallback.final;
          } catch (dshError) {
            throw new ExecutorFailure(
              `Codex 主执行基础设施失败：${detail.slice(-1500)}${fallbackError ? `\n\nClaude Code 兜底失败：${fallbackError.message}` : ""}\n\nDSH native 兜底失败：${dshError.message}`,
              {
                cause: dshError,
                executor: "dsh-native",
                retryable: Boolean(dshError.retryable) || isCodexInfrastructureFailure(dshError),
                timedOut: Boolean(dshError.timedOut),
                exitCode: dshError.exitCode,
              },
            );
          } finally {
            this.running.delete(job.sessionId);
          }
        }
        if (fallbackError) {
          throw new ExecutorFailure(
            `Codex 主执行基础设施失败：${detail.slice(-1500)}\n\nClaude Code 兜底失败：${fallbackError.message}`,
            {
              cause: fallbackError,
              executor: "claude",
              retryable: Boolean(fallbackError.retryable) || isCodexInfrastructureFailure(fallbackError),
              timedOut: Boolean(fallbackError.timedOut),
              exitCode: fallbackError.exitCode,
            },
          );
        }
      }
      throw new Error(`Codex 会话执行失败（exit ${result.code}）：\n${detail}`);
    }
    return final || "任务已执行完成，但 Codex 未返回最终文本。";
  }

  async create(prompt, requestId, onProgress = async () => {}, options = {}) {
    const fullPrompt = `${prompt}${SAFETY_CONTEXT.replace("请延续当前会话上下文执行。", "这是一个新会话，请从这条要求开始处理。")}`;
    const title = buildUniqueSessionTitle(
      options.title || prompt.trim().split("\n")[0],
      requestId,
    );
    try {
      const result = await createVisibleThread(this.config, fullPrompt, {
        ...options,
        title,
        onSpawn: (child) => this.running.set(`new:${requestId}`, child),
        onProgress,
      });
      return { ...result, title };
    } catch (error) {
      if (this.config.claudeFallbackEnabled === false || !isCodexInfrastructureFailure(error)) throw error;
      const job = { sessionId: null, prompt, executor: "claude" };
      const result = await runClaudeSession(this.config, job, fullPrompt, {
        readOnly: options.readOnly,
        timeoutMs: options.timeoutMs || this.config.claudeSessionTimeoutMs || 20 * 60_000,
        onSpawn: (child) => this.running.set(`new:${requestId}`, child),
      });
      return { sessionId: `claude:${result.sessionId}`, final: result.final, provider: "claude", title };
    } finally {
      this.running.delete(`new:${requestId}`);
    }
  }
}
