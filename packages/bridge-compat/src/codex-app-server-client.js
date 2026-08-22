import { spawn } from "node:child_process";
import { codexEnvironment } from "./cli-failover.js";

export function createVisibleThread(config, prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const model = options.model || config.codexNewThreadModel || "gpt-5.6-sol";
    const effort = options.effort || config.codexNewThreadEffort || "medium";
    const child = spawn(config.codexCli, ["app-server", "--stdio"], {
      cwd: config.workspaceRoot,
      env: codexEnvironment(config),
      stdio: ["pipe", "pipe", "pipe"],
    });
    options.onSpawn?.(child);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdoutBuffer = "";
    let stderr = "";
    let sessionId = null;
    let turnId = null;
    let final = "";
    let finished = false;
    const timeoutMs = options.timeoutMs || 20 * 60_000;

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const finish = (error = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.stdin.end();
      setTimeout(() => child.kill("SIGTERM"), 500).unref();
      if (error) reject(error);
      else resolve({ sessionId, final: final.trim() || "任务已执行完成，但 Codex 未返回最终文本。" });
    };
    const handle = (message) => {
      if (message.id === 1 && message.result) {
        send({ method: "initialized", params: {} });
        send({
          id: 2,
          method: "thread/start",
          params: {
            cwd: config.workspaceRoot,
            sandbox: options.readOnly ? "read-only" : "workspace-write",
            approvalPolicy: "never",
            ephemeral: false,
            model,
            threadSource: "quark-self-ai-compat",
            sessionStartSource: "startup",
          },
        });
        return;
      }
      if (message.id === 2 && message.result?.thread?.id) {
        sessionId = message.result.thread.id;
        if (options.title) send({ id: 4, method: "thread/name/set", params: { threadId: sessionId, name: options.title } });
        send({
          id: 3,
          method: "turn/start",
          params: {
            threadId: sessionId,
            input: [{ type: "text", text: prompt }],
            cwd: config.workspaceRoot,
            model,
            effort,
            sandboxPolicy: options.readOnly
              ? { type: "readOnly", networkAccess: false }
              : { type: "workspaceWrite", writableRoots: [config.workspaceRoot], networkAccess: false },
            approvalPolicy: "never",
          },
        });
        return;
      }
      if (message.id === 3 && message.result?.turn?.id) turnId = message.result.turn.id;
      if (message.method === "item/started" && message.params?.item?.type === "commandExecution") {
        void options.onProgress?.("正在执行并验证，请稍候……");
      }
      if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
        final = message.params.item.text || final;
      }
      if (message.method === "turn/completed" && message.params?.threadId === sessionId) {
        const status = message.params.turn?.status;
        if (status === "completed") finish();
        else {
          const error = new Error(`Codex 新会话执行未完成：${status || "unknown"}`);
          error.sessionId = sessionId;
          finish(error);
        }
      }
      if (message.id && message.error) {
        const error = new Error(`Codex app-server 请求失败：${message.error.message || JSON.stringify(message.error)}`);
        error.sessionId = sessionId;
        finish(error);
      }
    };
    child.stdout.on("data", (data) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        try { handle(JSON.parse(line)); } catch {}
      }
    });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!finished) finish(new Error(`Codex app-server 提前退出（exit ${code}）：${stderr.trim().slice(-3000)}`));
    });
    const timeout = setTimeout(() => {
      if (sessionId && turnId) send({ id: 5, method: "turn/interrupt", params: { threadId: sessionId, turnId } });
      const error = new Error(`Codex 新会话执行超过 ${Math.round(timeoutMs / 60_000)} 分钟，会话已保留。`);
      error.sessionId = sessionId;
      finish(error);
    }, timeoutMs);
    timeout.unref();
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "quark-self-ai-compat", version: "0.1.0" }, capabilities: { experimentalApi: true } },
    });
  });
}

export function runStructuredTurn(config, prompt, outputSchema, options = {}) {
  return new Promise((resolve, reject) => {
    const model = options.model || "gpt-5.6-luna";
    const effort = options.effort || "low";
    const child = spawn(config.codexCli, ["app-server", "--stdio"], {
      cwd: config.workspaceRoot,
      env: codexEnvironment(config),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdoutBuffer = "";
    let stderr = "";
    let threadId = null;
    let turnId = null;
    let final = "";
    let finished = false;
    const timeoutMs = Number(options.timeoutMs || 180000);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const finish = (error = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.stdin.end();
      setTimeout(() => child.kill("SIGTERM"), 500).unref();
      if (error) reject(error);
      else {
        try { resolve(JSON.parse(final)); }
        catch (parseError) { reject(new Error(`Codex 结构化结果无效：${parseError.message}`)); }
      }
    };
    const handle = (message) => {
      if (message.id === 1 && message.result) {
        send({ method: "initialized", params: {} });
        send({
          id: 2,
          method: "thread/start",
          params: {
            cwd: config.workspaceRoot,
            sandbox: "read-only",
            approvalPolicy: "never",
            ephemeral: true,
            model,
            threadSource: "codex-lark-structured-worker",
            sessionStartSource: "startup",
          },
        });
        return;
      }
      if (message.id === 2 && message.result?.thread?.id) {
        threadId = message.result.thread.id;
        send({
          id: 3,
          method: "turn/start",
          params: {
            threadId,
            input: [{ type: "text", text: prompt }],
            cwd: config.workspaceRoot,
            model,
            effort,
            outputSchema,
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            approvalPolicy: "never",
          },
        });
        return;
      }
      if (message.id === 3 && message.result?.turn?.id) turnId = message.result.turn.id;
      if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
        final = message.params.item.text || final;
      }
      if (message.method === "turn/completed" && message.params?.threadId === threadId) {
        const status = message.params.turn?.status;
        if (status === "completed") finish();
        else finish(new Error(`Codex 结构化任务未完成：${status || "unknown"}`));
      }
      if (message.id && message.error) finish(new Error(`Codex app-server 请求失败：${message.error.message || JSON.stringify(message.error)}`));
    };
    child.stdout.on("data", (data) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        try { handle(JSON.parse(line)); } catch {}
      }
    });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!finished) finish(new Error(`Codex app-server 提前退出（exit ${code}）：${stderr.trim().slice(-2000)}`));
    });
    const timeout = setTimeout(() => {
      if (threadId && turnId) send({ id: 5, method: "turn/interrupt", params: { threadId, turnId } });
      finish(new Error("Codex 结构化任务超时，消息已保留等待重试。"));
    }, timeoutMs);
    timeout.unref();
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "codex-lark-structured-worker", version: "0.1.0" }, capabilities: { experimentalApi: true } },
    });
  });
}
