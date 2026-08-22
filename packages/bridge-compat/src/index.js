import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bridge } from "./bridge.js";
import { CodexRunner } from "./codex-runner.js";
import { LarkClient } from "./lark-client.js";
import { DidaTaskCreator } from "./dida-task-creator.js";
import { DidaOverdueMonitor } from "./dida-overdue-monitor.js";
import { DidaCompletedCleanupMonitor } from "./dida-completed-cleanup-monitor.js";
import { MentionMonitor } from "./mention-monitor.js";
import { SessionStore } from "./session-store.js";
import { StateStore } from "./state-store.js";
import { SessionJanitor } from "./session-janitor.js";
import { WorkdayFollowupMonitor } from "./weekly-followup-monitor.js";
import { XiaoweiResearchChannel } from "./xiaowei-research-channel.js";
import { ShadowCollaborationMonitor } from "./shadow-collaboration.js";
import { formatUserTime } from "./util.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadConfig() {
  const configPath = process.env.CODEX_LARK_CONFIG || path.join(projectRoot, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return {
    larkCli: "lark-cli",
    codexCli: "codex",
    claudeCli: "claude",
    claudeFallbackEnabled: true,
    codexUseChatgptAuth: true,
    codexNewThreadModel: "gpt-5.6-sol",
    codexNewThreadEffort: "medium",
    claudeUseSubscriptionAuth: true,
    claudeExecutionTimeoutMs: 600000,
    claudeSessionTimeoutMs: 1200000,
    maxCandidates: 5,
    maxReplyChars: 12000,
    notificationTimeZone: "Asia/Shanghai",
    progressIntervalMs: 60000,
    bridgeControlMcpEnabled: true,
    mentionPollIntervalMs: 60000,
    mentionRateLimitBaseMs: 120000,
    mentionRateLimitMaxMs: 1800000,
    mentionRateLimitNotifyAfterMs: 1800000,
    mentionInitialLookbackMinutes: 30,
    mentionOverlapMinutes: 2,
    mentionContextMinutes: 30,
    mentionSettleDelayMs: 120000,
    monitorDirectMessages: true,
    specialAttentionUsers: [],
    monitorFlaggedConversations: true,
    flaggedConversationSyncIntervalMs: 300000,
    flagPageLimit: 1000,
    didaExecutionTimeoutMs: 300000,
    didaCli: "dida",
    didaCliTimeoutMs: 30000,
    verifyCreatedTaskKind: true,
    didaPrimaryProvider: "claude",
    didaCliConfigPath: path.join(os.homedir(), ".config", "dida-cli", "config.json"),
    didaTokenEnvVar: "DIDA365_TOKEN",
    overduePollIntervalMs: 1800000,
    overdueRetryIntervalMs: 120000,
    overdueFailureNotifyThreshold: 3,
    didaCompletedCleanupEnabled: true,
    didaCompletedRetentionDays: 30,
    didaCompletedCleanupMaxPerRun: 50,
    didaCompletedCleanupIntervalMs: 21600000,
    didaCompletedCleanupTimeZone: "Asia/Shanghai",
    didaCompletedCleanupHour: 3,
    didaCompletedCleanupFailureNotifyThreshold: 3,
    sessionRetryBaseMs: 30000,
    sessionRetryMaxMs: 300000,
    xiaoweiPollIntervalMs: 300000,
    xiaoweiInitialLookbackMinutes: 180,
    sessionCleanupIntervalMs: 21600000,
    sessionDeleteAfterDays: 7,
    followupPollIntervalMs: 3600000,
    followupReplyPollIntervalMs: 1800000,
    followupTimeZone: "Asia/Shanghai",
    followupScheduledHour: 10,
    shadowCollaborationEnabled: true,
    shadowCollaborationDays: 7,
    shadowPollIntervalMs: 1800000,
    shadowCalendarPollIntervalMs: 1800000,
    shadowCalendarLookaheadDays: 8,
    shadowTaskFeedbackPollIntervalMs: 21600000,
    shadowNotifyOnComplete: true,
    ...config,
    varDir: config.varDir || path.join(projectRoot, "var"),
    didaResultSchemaPath: config.didaResultSchemaPath || path.join(projectRoot, "schemas", "dida-task-result.schema.json"),
    didaOverdueSchemaPath: config.didaOverdueSchemaPath || path.join(projectRoot, "schemas", "dida-overdue-result.schema.json"),
    didaCompletionSchemaPath: config.didaCompletionSchemaPath || path.join(projectRoot, "schemas", "dida-completion-result.schema.json"),
    didaCleanupSchemaPath: config.didaCleanupSchemaPath || path.join(projectRoot, "schemas", "dida-cleanup-result.schema.json"),
    didaFollowupSchemaPath: config.didaFollowupSchemaPath || path.join(projectRoot, "schemas", "dida-followup-result.schema.json"),
    didaFollowupUpdateSchemaPath: config.didaFollowupUpdateSchemaPath || path.join(projectRoot, "schemas", "dida-followup-update-result.schema.json"),
  };
}

const config = await loadConfig();
for (const key of ["allowedOpenId", "codexHome", "workspaceRoot", "didaProjectId", "followupProjectId"]) {
  if (!config[key]) throw new Error(`config.json 缺少 ${key}`);
}

const state = new StateStore(config.varDir);
await state.load();
const sessions = new SessionStore(config.codexHome, () => state.state.claudeFallbackSessions);
const lark = new LarkClient(config);
const runner = new CodexRunner(config);
const taskCreator = new DidaTaskCreator(config);
const followupMonitor = new WorkdayFollowupMonitor({ config, state, lark, taskCreator });
const xiaoweiResearch = new XiaoweiResearchChannel({ config, state, lark, taskCreator });
const shadowCollaboration = new ShadowCollaborationMonitor({ config, state, lark });
const bridge = new Bridge({ config, sessions, state, lark, runner, followupManager: followupMonitor });
const mentionMonitor = new MentionMonitor({
  config, state, lark, taskCreator, runner, xiaoweiResearch, shadowCollaboration,
});
const overdueMonitor = new DidaOverdueMonitor({ config, state, lark, taskCreator });
const didaCompletedCleanupMonitor = new DidaCompletedCleanupMonitor({ config, state, lark, taskCreator });
const sessionJanitor = new SessionJanitor({ config, state, lark, runner, taskCreator });
const listener = lark.listen((event) => void bridge.handle(event));
let cardListener = null;
let cardReconnectTimer = null;
let stopping = false;

async function recordCardListenerFailure(detail) {
  const setupNotificationVersion = 2;
  if (stopping) return;
  console.error(`card action listener unavailable: ${detail}`);
  const setupUrl = detail.match(/https:\/\/[^"\s]+/)?.[0] || null;
  const firstFailure = !state.state.cardActionHealthFailure;
  const shouldNotify = firstFailure
    || (setupUrl && setupUrl !== state.state.cardActionHealthFailure?.setupUrl)
    || (setupUrl && state.state.cardActionHealthFailure?.setupNotificationVersion !== setupNotificationVersion);
  if (firstFailure) {
    state.state.cardActionHealthFailure = { at: new Date().toISOString(), error: detail };
  } else {
    state.state.cardActionHealthFailure.error = detail;
  }
  if (setupUrl) {
    state.state.cardActionHealthFailure.setupUrl = setupUrl;
    state.state.cardActionHealthFailure.setupNotificationVersion = setupNotificationVersion;
  }
  if (shouldNotify) {
    await state.save();
    const message = `飞书交互卡片回调尚未启用。普通卡片和文字回复不受影响，但按钮、下拉框和表单暂时无法提交。\n\n需要你在飞书开发者后台为应用 cli_a96daefa2bbb5bd9 启用 card.action.trigger 回调。这会修改应用的回调配置，不涉及业务数据。`;
    try {
      let sent;
      if (setupUrl) {
        sent = await lark.sendInteractive(message, [{ text: "打开飞书配置", url: setupUrl }], {
          title: "需要启用卡片回调", tone: "yellow",
        }, `card-listener-setup:${state.state.cardActionHealthFailure.at}:v${setupNotificationVersion}`);
      } else {
        sent = await lark.send(message, `card-listener-setup:${state.state.cardActionHealthFailure.at}`);
      }
      state.state.cardActionHealthFailure.notificationMessageId = sent?.message_id || sent?.messageId || null;
      state.state.cardActionHealthFailure.notificationChatId = sent?.chat_id || sent?.chatId || null;
      await state.save();
    } catch {}
  }
  clearTimeout(cardReconnectTimer);
  cardReconnectTimer = setTimeout(startCardListener, 5 * 60_000);
}

function startCardListener() {
  if (stopping) return;
  let ready = false;
  let stderrBuffer = "";
  cardListener = lark.listenCardActions((event) => void bridge.handleCardAction(event).catch(async (error) => {
    console.error("card action failed", error);
    try { await lark.send(`飞书卡片操作处理失败，请直接回复文字继续。\n\n${error.message}`, `card-action-failed:${event.event_id}`); } catch {}
  }));
  cardListener.stderr.on("data", (data) => {
    stderrBuffer = `${stderrBuffer}${String(data)}`.slice(-8000);
    if (String(data).includes("[event] ready event_key=card.action.trigger")) {
      ready = true;
      if (state.state.cardActionHealthFailure) {
        const failedAt = state.state.cardActionHealthFailure.at;
        state.state.cardActionHealthFailure = null;
        void state.save().then(() => lark.send(
          `飞书交互卡片回调已恢复。故障始于：${formatUserTime(failedAt, config.notificationTimeZone)}（北京时间）`,
          `card-listener-recovered:${failedAt}`,
        )).catch(() => {});
      }
    }
  });
  cardListener.on("error", (error) => void recordCardListenerFailure(error.message));
  cardListener.on("exit", (code, signal) => {
    if (!stopping && !ready) void recordCardListenerFailure(stderrBuffer.trim() || `exit=${code} signal=${signal}`);
    else if (!stopping) void recordCardListenerFailure(`连接退出：exit=${code} signal=${signal}`);
  });
}

startCardListener();
const timer = setInterval(() => void bridge.retryQueued(), 15000);
const mentionTimer = setInterval(() => void mentionMonitor.poll(), config.mentionPollIntervalMs);
void mentionMonitor.poll();
const overdueTimer = setInterval(() => void overdueMonitor.poll(), config.overduePollIntervalMs);
const overdueStartupTimer = setTimeout(() => void overdueMonitor.poll(), Math.min(300000, config.overduePollIntervalMs));
const didaCompletedCleanupTimer = setInterval(
  () => void didaCompletedCleanupMonitor.poll(), config.didaCompletedCleanupIntervalMs,
);
const didaCompletedCleanupStartupTimer = setTimeout(
  () => void didaCompletedCleanupMonitor.poll(), Math.min(120000, config.didaCompletedCleanupIntervalMs),
);
const cleanupTimer = setInterval(() => void sessionJanitor.sweep(), config.sessionCleanupIntervalMs);
const cleanupStartupTimer = setTimeout(() => void sessionJanitor.sweep(), Math.min(10000, config.sessionCleanupIntervalMs));
const followupTimer = setInterval(() => void followupMonitor.poll(), config.followupPollIntervalMs);
void followupMonitor.poll();
const xiaoweiTimer = setInterval(() => void xiaoweiResearch.poll(), config.xiaoweiPollIntervalMs);
void xiaoweiResearch.poll();
const shadowTimer = setInterval(() => void shadowCollaboration.poll(), config.shadowPollIntervalMs);
void shadowCollaboration.poll();
async function recordListenerFailure(detail) {
  if (stopping) return;
  if (!state.state.mentionHealthFailure) {
    state.state.mentionHealthFailure = { at: new Date().toISOString(), error: detail };
    await state.save();
  }
  try {
    await lark.send(`飞书实时指令连接已中断，服务将自动重启并恢复。\n\n${detail}`, `listener-failed:${state.state.mentionHealthFailure.at}`);
  } catch {}
  process.exit(1);
}

listener.on("error", (error) => void recordListenerFailure(error.message));
listener.on("exit", (code, signal) => void recordListenerFailure(`exit=${code} signal=${signal}`));

function shutdown(signal) {
  console.error(`received ${signal}, stopping`);
  stopping = true;
  clearInterval(timer);
  clearInterval(mentionTimer);
  clearInterval(overdueTimer);
  clearTimeout(overdueStartupTimer);
  clearInterval(didaCompletedCleanupTimer);
  clearTimeout(didaCompletedCleanupStartupTimer);
  clearInterval(cleanupTimer);
  clearTimeout(cleanupStartupTimer);
  clearInterval(followupTimer);
  clearInterval(xiaoweiTimer);
  clearInterval(shadowTimer);
  clearTimeout(cardReconnectTimer);
  listener.stdin.end();
  cardListener?.stdin.end();
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
console.error("codex-lark-bridge started");
