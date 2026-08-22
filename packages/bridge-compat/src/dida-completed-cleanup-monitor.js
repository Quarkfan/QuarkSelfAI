import { formatUserTime } from "./util.js";

function localSlot(now, timeZone, scheduledHour) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    due: Number(parts.hour) >= scheduledHour,
  };
}

export class DidaCompletedCleanupMonitor {
  constructor({ config, state, lark, taskCreator, logger = console }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.taskCreator = taskCreator;
    this.logger = logger;
    this.running = false;
  }

  async poll(now = new Date()) {
    if (this.running || this.config.didaCompletedCleanupEnabled === false) return;
    const slot = localSlot(
      now,
      this.config.didaCompletedCleanupTimeZone || "Asia/Shanghai",
      Number(this.config.didaCompletedCleanupHour ?? 3),
    );
    if (!slot.due || this.state.state.didaCompletedCleanupLastDay === slot.dayKey) return;
    this.running = true;
    try {
      const result = await this.taskCreator.cleanupCompletedTasks(now);
      this.state.state.didaCompletedCleanupLastDay = slot.dayKey;
      this.state.state.didaCompletedCleanupLastAt = now.toISOString();
      const previousFailure = this.state.state.didaCompletedCleanupHealthFailure;
      this.state.state.didaCompletedCleanupHealthFailure = null;
      await this.state.save();
      if (result.deleted.length) {
        const sample = result.deleted.slice(0, 10)
          .map((task, index) => `${index + 1}. ${task.title}（完成于 ${task.completedAt}）`).join("\n");
        await this.lark.send(
          `已清理自动化待办中 ${result.deleted.length} 条超过保留期的已完成任务。\n\n${sample}${result.deleted.length > 10 ? `\n\n其余 ${result.deleted.length - 10} 条已一并清理。` : ""}`,
          `dida-completed-cleanup:${slot.dayKey}`,
        );
      } else if (previousFailure?.notified) {
        await this.lark.send(
          `滴答已完成任务清理已恢复。故障始于：${formatUserTime(previousFailure.at, this.config.notificationTimeZone)}（北京时间）`,
          `dida-completed-cleanup-recovered:${previousFailure.at}`,
        );
      }
    } catch (error) {
      this.logger.error("completed Dida cleanup failed", error);
      const failure = this.state.state.didaCompletedCleanupHealthFailure || {
        at: now.toISOString(), count: 0, notified: false,
      };
      failure.count = Number(failure.count || 0) + 1;
      failure.error = error.message;
      this.state.state.didaCompletedCleanupHealthFailure = failure;
      const threshold = Number(this.config.didaCompletedCleanupFailureNotifyThreshold ?? 3);
      if (!failure.notified && failure.count >= threshold) {
        failure.notified = true;
        await this.state.save();
        try {
          await this.lark.send(
            `滴答已完成任务清理连续 ${failure.count} 次失败，后台会继续定期重试。\n\n${error.message}`,
            `dida-completed-cleanup-failed:${failure.at}`,
          );
        } catch {}
      } else {
        await this.state.save();
      }
    } finally {
      this.running = false;
    }
  }
}

export { localSlot as didaCompletedCleanupSlot };
