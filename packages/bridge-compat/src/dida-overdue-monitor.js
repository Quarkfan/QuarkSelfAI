import { formatUserTime } from "./util.js";

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

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const result = await this.taskCreator.listOverdue();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      const notifications = this.state.state.overdueNotified;
      for (const task of result.tasks) {
        const fingerprint = `${task.dueDate}:${task.priority}`;
        if (notifications[task.taskId] === fingerprint) continue;
        await this.lark.send(
          `**自动化待办已超期：${task.title}**\n\n截止：${task.dueDate}\n优先级：${task.priority}${task.url ? `\n${task.url}` : ""}`,
          `overdue:${task.taskId}:${fingerprint}`,
        );
        notifications[task.taskId] = fingerprint;
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
