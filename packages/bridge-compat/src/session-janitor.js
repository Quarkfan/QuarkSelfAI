import { formatUserTime, run } from "./util.js";
import path from "node:path";
import { pruneDshFallbackSessions } from "./cli-failover.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export async function getCodexSessionState(config, sessionId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  const database = config.codexStateDb || path.join(config.codexHome, "state_5.sqlite");
  const result = await run(config.sqliteCli || "sqlite3", [
    database,
    `SELECT archived FROM threads WHERE id = '${sessionId}' LIMIT 1;`,
  ], { timeoutMs: 5000 });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  if (value === "1") return { exists: true, archived: true };
  if (value === "0") return { exists: true, archived: false };
  return { exists: false, archived: false };
}

export async function isArchivedInCodexState(config, sessionId) {
  const state = await getCodexSessionState(config, sessionId);
  return state?.exists ? state.archived : null;
}

export class SessionJanitor {
  constructor({
    config, state, lark, runner, taskCreator, logger = console,
    archiveStatus = isArchivedInCodexState, sessionStatus = getCodexSessionState,
  }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.runner = runner;
    this.taskCreator = taskCreator;
    this.logger = logger;
    this.archiveStatus = archiveStatus;
    this.sessionStatus = sessionStatus;
    this.running = false;
  }

  async markDeleted(session, now) {
    session.deletedAt = now.toISOString();
    session.deleteFailureCount = 0;
    session.deleteLastError = null;
    session.deleteNextRetryAt = null;
    session.deleteLastNotifiedAt = null;
    await this.state.save();
  }

  async recordDeleteFailure(session, error, now) {
    const count = Number(session.deleteFailureCount || 0) + 1;
    const retryDelayMs = Math.min(DAY_MS, HOUR_MS * (2 ** Math.min(count - 1, 5)));
    session.deleteFailureCount = count;
    session.deleteLastAttemptAt = now.toISOString();
    session.deleteNextRetryAt = new Date(now.getTime() + retryDelayMs).toISOString();
    session.deleteLastError = error.message.slice(-2000);
    const lastNotifiedAt = Date.parse(session.deleteLastNotifiedAt || "");
    const shouldNotify = !Number.isFinite(lastNotifiedAt) || now.getTime() - lastNotifiedAt >= DAY_MS;
    if (shouldNotify) session.deleteLastNotifiedAt = now.toISOString();
    await this.state.save();
    this.logger.error("session deletion failed", error);
    if (shouldNotify) {
      try {
        await this.lark.send(
          `Codex 自动调研会话到期删除失败，已进入退避重试。\n\n${error.message}\n下次最早重试：${formatUserTime(session.deleteNextRetryAt, this.config.notificationTimeZone || "Asia/Shanghai")}（北京时间）`,
          `session-delete-failed:${session.sessionId}:${session.deleteLastNotifiedAt}`,
        );
      } catch {}
    }
  }

  async deleteExpired(now) {
    const deleteAfterMs = Number(this.config.sessionDeleteAfterDays ?? 7) * DAY_MS;
    const candidates = this.state.state.mentionResearchSessions.filter((session) =>
      session.archivedAt && !session.deletedAt && !this.runner.isRunning(session.sessionId)
      && now.getTime() - Date.parse(session.archivedAt) >= deleteAfterMs
      && (!session.deleteNextRetryAt || Date.parse(session.deleteNextRetryAt) <= now.getTime())).slice(0, 20);
    for (const session of candidates) {
      try {
        let codexState = await this.sessionStatus(this.config, session.sessionId);
        if (codexState?.exists === false) {
          await this.markDeleted(session, now);
          continue;
        }
        if (!codexState) throw new Error(`无法确认会话 ${session.sessionId} 的 Codex 状态，已取消本次删除`);
        if (!codexState.archived) continue;
        // The CLI only permits non-interactive deletion with --force and an
        // exact UUID. UUID shape and archived state were both verified above.
        const result = await run(this.config.codexCli, ["delete", "--force", session.sessionId], { cwd: this.config.workspaceRoot });
        if (result.code !== 0) {
          codexState = await this.sessionStatus(this.config, session.sessionId);
          if (codexState?.exists !== false) {
            throw new Error(`删除 ${session.sessionId} 失败：${(result.stderr || result.stdout).trim().slice(-1500)}`);
          }
        }
        await this.markDeleted(session, now);
      } catch (error) {
        await this.recordDeleteFailure(session, error, now);
      }
    }
  }

  async markArchived(session, now, alreadyArchived, notify = true) {
    session.archivedAt = now.toISOString();
    session.archiveFailureCount = 0;
    session.archiveLastError = null;
    session.archiveNextRetryAt = null;
    session.archiveLastNotifiedAt = null;
    await this.state.save();
    if (notify) {
      await this.lark.send(
        `${alreadyArchived ? "检测到" : "检测到关联滴答任务已完成，已"}归档自动调研会话：${session.sessionId}\n任务：${session.taskId}`,
        `session-archived:${session.sessionId}`,
      );
    }
  }

  async recordFailure(session, error, now) {
    const count = Number(session.archiveFailureCount || 0) + 1;
    const retryDelayMs = Math.min(DAY_MS, HOUR_MS * (2 ** Math.min(count - 1, 5)));
    session.archiveFailureCount = count;
    session.archiveLastAttemptAt = now.toISOString();
    session.archiveNextRetryAt = new Date(now.getTime() + retryDelayMs).toISOString();
    session.archiveLastError = error.message.slice(-2000);
    const lastNotifiedAt = Date.parse(session.archiveLastNotifiedAt || "");
    const shouldNotify = !Number.isFinite(lastNotifiedAt) || now.getTime() - lastNotifiedAt >= DAY_MS;
    if (shouldNotify) session.archiveLastNotifiedAt = now.toISOString();
    await this.state.save();
    this.logger.error("session cleanup failed", error);
    if (shouldNotify) {
      try {
        await this.lark.send(
          `Codex 自动调研会话清理失败，已进入退避重试。\n\n${error.message}\n下次最早重试：${session.archiveNextRetryAt}`,
          `session-cleanup-failed:${session.sessionId}:${session.archiveLastNotifiedAt}`,
        );
      } catch {}
    }
  }

  async sweep(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await pruneDshFallbackSessions(this.config, now);
      await this.deleteExpired(now);
      const waitingIds = new Set(this.state.state.mentionClarifications.map((item) => item.researchSessionId).filter(Boolean));
      const candidates = this.state.state.mentionResearchSessions.filter((session) =>
        !session.archivedAt && session.taskId && !waitingIds.has(session.sessionId) && !this.runner.isRunning(session.sessionId)
        && (!session.archiveNextRetryAt || Date.parse(session.archiveNextRetryAt) <= now.getTime())).slice(0, 20);
      const pending = [];
      for (const session of candidates) {
        if (await this.archiveStatus(this.config, session.sessionId)) {
          // Reconcile desktop-side/manual archives without requiring a Dida network call.
          await this.markArchived(session, now, true, false);
        } else {
          pending.push(session);
        }
      }
      const completed = new Set(await this.taskCreator.getCompletedTaskIds(pending.map((session) => session.taskId)));
      for (const session of pending) {
        if (!completed.has(session.taskId)) continue;
        try {
          let alreadyArchived = await this.archiveStatus(this.config, session.sessionId);
          if (!alreadyArchived) {
            const result = await run(this.config.codexCli, ["archive", session.sessionId], { cwd: this.config.workspaceRoot });
            if (result.code !== 0) {
              // The desktop app may win the race and archive between the pre-check and CLI call.
              alreadyArchived = await this.archiveStatus(this.config, session.sessionId);
              if (!alreadyArchived) {
                throw new Error(`归档 ${session.sessionId} 失败：${(result.stderr || result.stdout).trim().slice(-1500)}`);
              }
            }
          }
          await this.markArchived(session, now, alreadyArchived);
        } catch (error) {
          await this.recordFailure(session, error, now);
        }
      }
    } catch (error) {
      this.logger.error("session cleanup failed", error);
      try { await this.lark.send(`Codex 自动调研会话清理检查失败，后台稍后重试。\n\n${error.message}`, `session-cleanup-sweep-failed:${now.toISOString().slice(0, 13)}`); } catch {}
    } finally {
      this.running = false;
    }
  }
}
