import { formatUserTime, isWithinLocalHourWindow } from "./util.js";

function normalizedDueDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`滴答任务截止时间无效：${String(value).slice(0, 100)}`);
  return parsed.toISOString();
}

export function overdueFingerprint(task) {
  return `${normalizedDueDate(task.dueDate)}:${Number(task.priority)}`;
}

function localDay(value, timeZone) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(parsed).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function equivalentStoredFingerprint(stored, task, timeZone = "Asia/Shanghai") {
  if (typeof stored !== "string") return false;
  const separator = stored.lastIndexOf(":");
  if (separator < 0 || Number(stored.slice(separator + 1)) !== Number(task.priority)) return false;
  try {
    const previous = normalizedDueDate(stored.slice(0, separator));
    const current = normalizedDueDate(task.dueDate);
    return previous === current || localDay(previous, timeZone) === localDay(current, timeZone);
  }
  catch { return false; }
}

function trustedTaskUrl(projectId, taskId) {
  if (!projectId || !taskId) return null;
  return `https://dida365.com/webapp/#p/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
}

export class DidaOverdueMonitor {
  constructor({ config = {}, state, lark, taskCreator, logger = console }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.taskCreator = taskCreator;
    this.logger = logger;
    this.polling = false;
    this.retryTimer = null;
  }

  async poll(now = new Date()) {
    if (this.polling) return;
    this.polling = true;
    try {
      const result = await this.taskCreator.listOverdue();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      const notifications = this.state.state.overdueNotified;
      const lastNotifiedAt = this.state.state.overdueLastNotifiedAt ??= {};
      const timeZone = this.config.notificationTimeZone || "Asia/Shanghai";
      const canNotify = isWithinLocalHourWindow(
        now, timeZone,
        Number(this.config.overdueNotificationStartHour ?? 9),
        Number(this.config.overdueNotificationEndHour ?? 19),
      );
      const minimumIntervalMs = Number(this.config.overdueReminderMinimumIntervalMs ?? 24 * 60 * 60_000);
      const pending = [];
      for (const task of result.tasks) {
        const dueDate = normalizedDueDate(task.dueDate);
        const fingerprint = overdueFingerprint(task);
        if (notifications[task.taskId] === fingerprint || equivalentStoredFingerprint(notifications[task.taskId], task, timeZone)) {
          if (notifications[task.taskId] !== fingerprint) {
            notifications[task.taskId] = fingerprint;
            await this.state.save();
          }
          continue;
        }
        const previousNotification = Date.parse(lastNotifiedAt[task.taskId] || "");
        if (!canNotify || (Number.isFinite(previousNotification) && now.getTime() - previousNotification < minimumIntervalMs)) continue;
        const url = trustedTaskUrl(this.config.didaProjectId, task.taskId);
        pending.push({ task, dueDate, fingerprint, url });
      }
      if (pending.length) {
        const lines = pending.map(({ task, dueDate, url }) => (
          `- **${task.title}**\n  截止：${formatUserTime(dueDate, timeZone)} · 优先级 ${task.priority}${url ? ` · ${url}` : ""}`
        ));
        await this.lark.send(
          `**自动化待办超期汇总**\n\n${lines.join("\n")}\n\n同一任务 24 小时内不重复提醒；完成后将自动停止提醒。`,
          `overdue-digest:${now.toISOString().slice(0, 10)}:${pending.map((item) => item.task.taskId).sort().join(":")}`,
        );
        for (const { task, fingerprint } of pending) {
          notifications[task.taskId] = fingerprint;
          lastNotifiedAt[task.taskId] = now.toISOString();
        }
        await this.state.save();
      }
      if (this.state.state.overdueHealthFailure) {
        const failure = this.state.state.overdueHealthFailure;
        this.state.state.overdueHealthFailure = null;
        await this.state.save();
        if (failure.notified) {
          await this.lark.send(
            `滴答清单超期监控已恢复。故障始于：${formatUserTime(failure.at, this.config.notificationTimeZone)}（北京时间）`,
            `overdue-recovered:${failure.at}`,
          );
        }
      }
    } catch (error) {
      this.logger.error("overdue poll failed", error);
      const failure = this.state.state.overdueHealthFailure || {
        at: new Date().toISOString(), count: 0, notified: false,
      };
      failure.count = (failure.count || 0) + 1;
      failure.error = error.message;
      this.state.state.overdueHealthFailure = failure;
      await this.state.save();
      const threshold = this.config.overdueFailureNotifyThreshold || 3;
      if (!failure.notified && failure.count >= threshold) {
        failure.notified = true;
        await this.state.save();
        try {
          await this.lark.send(`滴答清单超期监控连续 ${failure.count} 次失败，后台会持续重试。\n\n${error.message}`, `overdue-failed:${failure.at}`);
        } catch {}
      }
      this.scheduleRetry();
    } finally {
      this.polling = false;
    }
  }


  scheduleRetry() {
    if (this.retryTimer) return;
    const delayMs = this.config.overdueRetryIntervalMs || 120_000;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.poll();
    }, delayMs);
    this.retryTimer.unref?.();
  }
}
