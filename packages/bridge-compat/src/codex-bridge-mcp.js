import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CodexRunner } from "./codex-runner.js";
import { SessionStore } from "./session-store.js";
import { QuarkControlPlaneClient } from "./quark-control-plane-client.js";
import { LarkClient } from "./lark-client.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.env.CODEX_LARK_CONFIG || path.join(projectRoot, "config.json");
const rawConfig = JSON.parse(await readFile(configPath, "utf8"));
const config = {
  codexCli: "codex",
  claudeCli: "claude",
  codexUseChatgptAuth: true,
  codexNewThreadModel: "gpt-5.6-sol",
  codexNewThreadEffort: "medium",
  claudeFallbackEnabled: true,
  claudeSessionTimeoutMs: 1_200_000,
  progressIntervalMs: 60_000,
  ...rawConfig,
  varDir: rawConfig.varDir || path.join(projectRoot, "var"),
  bridgeControlMcpEnabled: false,
};

const statePath = path.join(config.varDir, "state.json");

async function readState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(error, suggestion) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: `${String(error?.message || error)}${suggestion ? `\n建议：${suggestion}` : ""}`,
    }],
  };
}

const sessions = new SessionStore(config.codexHome);
const runner = new CodexRunner(config, { error: (...args) => console.error(...args) });
const server = new McpServer({ name: "codex-bridge-mcp-server", version: "1.0.0" });
const controlPlane = new QuarkControlPlaneClient();
const lark = new LarkClient(config, { error: (...args) => console.error(...args) });

async function listAllSessions() {
  const codexSessions = await sessions.list();
  const state = await readState();
  const merged = new Map(codexSessions.map((session) => [session.id, session]));
  for (const session of state.claudeFallbackSessions || []) merged.set(session.id, session);
  return [...merged.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function getSession(sessionId) {
  return (await listAllSessions()).find((session) => session.id === sessionId) || null;
}

server.registerTool("codex_bridge_list_sessions", {
  title: "List or search Codex tasks",
  description: "List visible local Codex tasks, optionally filtering by a title keyword or task ID. Use before routing when the user names another task but its exact ID is unknown.",
  inputSchema: {
    query: z.string().trim().max(200).optional().describe("Optional title keyword, Jira key, project name, or task ID."),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ query, limit, offset }) => {
  try {
    const all = await listAllSessions();
    const needle = String(query || "").toLowerCase();
    const matches = needle
      ? all.filter((item) => item.id.toLowerCase().includes(needle) || String(item.title || "").toLowerCase().includes(needle))
      : all;
    const items = matches.slice(offset, offset + limit);
    return toolResult({
      total_count: matches.length,
      count: items.length,
      offset,
      has_more: offset + items.length < matches.length,
      next_offset: offset + items.length < matches.length ? offset + items.length : null,
      sessions: items,
    });
  } catch (error) {
    return toolError(error, "确认本机 Codex session_index.jsonl 可读。\n");
  }
});

server.registerTool("codex_bridge_get_status", {
  title: "Get Feishu bridge status",
  description: "Read the local bridge controller binding, queued requests, retry state, and recent execution history. This does not change the queue.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try {
    const state = await readState();
    const queue = state.queue || [];
    return toolResult({
      controller_session_id: state.controllerSessionId || state.currentSessionId || null,
      queued_count: queue.length,
      queued: queue.slice(0, 20).map((job) => ({
        id: job.id,
        session_id: job.sessionId,
        session_title: job.sessionTitle,
        received_at: job.receivedAt,
        attempts: job.attempts || 0,
        next_attempt_at: job.nextAttemptAt || null,
        stage: job.finalResult ? "result_delivery" : "execution",
      })),
      recent_executions: (state.executionHistory || []).slice(-20),
    });
  } catch (error) {
    return toolError(error, "确认桥接器状态文件可读。\n");
  }
});

server.registerTool("quark_work_journal_query", {
  title: "Query Dean's daily work journal",
  description: "Read the durable daily work journal for any inclusive date range. Use for daily, weekly, monthly, quarterly, annual, or custom-period work summaries. Missing dates and records with partial/unavailable sources must be supplemented with bounded read-only live evidence when needed.",
  inputSchema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).describe("Inclusive start date in Asia/Shanghai, YYYY-MM-DD."),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).describe("Inclusive end date in Asia/Shanghai, YYYY-MM-DD."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ from, to }) => {
  try {
    if (from > to) throw new Error("开始日期不能晚于结束日期。");
    const result = await controlPlane.queryWorkJournal(from, to);
    const recorded = new Set((result.records || []).map((record) => record.day));
    const missing = [];
    for (let cursor = new Date(`${from}T12:00:00Z`), end = new Date(`${to}T12:00:00Z`); cursor <= end && missing.length < 4000; cursor = new Date(cursor.getTime() + 86400000)) {
      const day = cursor.toISOString().slice(0, 10);
      if (!recorded.has(day)) missing.push(day);
    }
    const partial = (result.records || []).flatMap((record) => {
      const unavailable = (record.sources || []).filter((source) => source.status !== "available").map((source) => source.kind);
      return unavailable.length ? [{ day: record.day, sources: unavailable }] : [];
    });
    return toolResult({ ...result, missing_dates: missing, partial_dates: partial, coverage_complete: missing.length === 0 && partial.length === 0 });
  } catch (error) {
    return toolError(error, "核对日期范围；缺失日期可通过只读实时来源补齐。\n");
  }
});

server.registerTool("codex_bridge_send_to_session", {
  title: "Send work to an existing Codex task",
  description: "Resume one specific existing Codex task with a natural-language requirement and wait for its final result. Use only when the user explicitly targets another task; do not use for work that belongs in the current controller task.",
  inputSchema: {
    session_id: z.string().trim().min(8).max(100).describe("Exact task ID returned by codex_bridge_list_sessions."),
    prompt: z.string().trim().min(1).max(50_000).describe("Complete natural-language requirement, including scope and constraints."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ session_id: sessionId, prompt }) => {
  try {
    const state = await readState();
    const controllerId = state.controllerSessionId || state.currentSessionId;
    if (sessionId === controllerId) {
      throw new Error("目标就是当前飞书总控任务；请直接在当前任务中执行，不要递归续接自己。");
    }
    const session = await getSession(sessionId);
    if (!session) throw new Error(`没有找到任务 ${sessionId}。`);
    const final = await runner.execute({
      id: `mcp:${Date.now()}`,
      sessionId,
      sessionTitle: session.title,
      prompt,
      executor: session.provider || "codex",
      requestedExecutor: session.provider || "codex",
      controller: false,
    });
    return toolResult({ session_id: sessionId, title: session.title, final });
  } catch (error) {
    return toolError(error, "重新查询任务列表；如果任务正忙，稍后重试同一个任务 ID。\n");
  }
});

server.registerTool("codex_bridge_create_session", {
  title: "Create a visible Codex task",
  description: "Create a new Codex task that appears in the desktop sidebar with an AI-created unique title, execute its first natural-language requirement, and wait for the final result. Use only when the user explicitly asks for a new task.",
  inputSchema: {
    prompt: z.string().trim().min(1).max(50_000).describe("The new task's complete first requirement."),
    title: z.string().trim().min(1).max(80).optional().describe("Concise sidebar title. Defaults to the first line of the requirement."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ prompt, title }) => {
  try {
    const result = await runner.create(prompt, `mcp:${Date.now()}`, async () => {}, {
      title: title || prompt.split("\n")[0].slice(0, 80),
      model: config.codexNewThreadModel,
      effort: config.codexNewThreadEffort,
    });
    return toolResult({ session_id: result.sessionId, title: result.title, provider: result.provider || "codex", final: result.final });
  } catch (error) {
    return toolError(error, "检查 Codex 连接；若错误包含已创建的任务 ID，请续接该任务而不是重复创建。\n");
  }
});

server.registerTool("quark_policy_propose", {
  title: "Propose a natural-language assistant policy",
  description: "Compile the owner's natural-language preference into the restricted QuarkSelfAI policy DSL, then submit it for deterministic local validation and simulation. Use this when the owner asks to add or change a persistent message/task/reply strategy. This creates only a draft and never activates it.",
  inputSchema: {
    source_text: z.string().trim().min(1).max(4000).describe("The owner's exact natural-language policy request."),
    document: z.record(z.string(), z.unknown()).describe("A PolicyDocument v1 using only the facts, operators and effects documented by QuarkSelfAI."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ source_text: sourceText, document }) => {
  try {
    const proposal = await controlPlane.proposePolicy(sourceText, document);
    const simulation = proposal.simulation;
    await lark.sendInteractive(
      `**${proposal.document.name}**\n\n${proposal.document.description}\n\n` +
      `样本：${simulation.sampleCount} · 命中：${simulation.matchedCount} · 紧急误抑制：${simulation.urgentSuppressedCount}\n\n` +
      `${simulation.safeToActivate ? "本地安全检查通过。" : "本地样本或安全覆盖不足，当前不能激活；可在输入框补充范围。"}`,
      simulation.safeToActivate ? [
        { text: "确认启用", value: { type: "policy_decision", decision: "approve", policyId: proposal.id, revision: proposal.revision, name: proposal.document.name } },
        { text: "暂不启用", value: { type: "policy_decision", decision: "decline", policyId: proposal.id, revision: proposal.revision, name: proposal.document.name } },
      ] : [
        { text: "保留草案", value: { type: "policy_decision", decision: "decline", policyId: proposal.id, revision: proposal.revision, name: proposal.document.name } },
      ],
      {
        title: "策略待确认",
        tone: simulation.safeToActivate ? "yellow" : "red",
        status: simulation.safeToActivate ? "等待确认" : "需要调整",
        includeInput: true,
        label: "补充或修改要求",
        placeholder: "例如：紧急事项仍然实时提醒",
      },
      `policy-proposal:${proposal.id}:${proposal.revision}`,
    );
    return toolResult({ ...proposal, approvalCardSent: true });
  } catch (error) {
    return toolError(error, "缩小策略范围或补足本地样本；不要绕过本地验证器。\n");
  }
});

server.registerTool("quark_policy_activate", {
  title: "Activate an owner-approved assistant policy",
  description: "Activate one exact validated policy revision only after the owner explicitly confirms that proposal. Never infer approval from the original policy request or from silence.",
  inputSchema: {
    policy_id: z.string().uuid(),
    revision: z.number().int().positive(),
    owner_confirmed: z.literal(true),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ policy_id: policyId, revision, owner_confirmed: ownerConfirmed }) => {
  try {
    return toolResult(await controlPlane.activatePolicy(policyId, revision, ownerConfirmed));
  } catch (error) {
    return toolError(error, "确认策略 ID、revision 与常东旭本次批准的卡片完全一致。\n");
  }
});

await server.connect(new StdioServerTransport());
