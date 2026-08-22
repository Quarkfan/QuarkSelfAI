import { SessionBusyError } from "./codex-runner.js";
import { shortId } from "./util.js";
import { buildNotificationCard } from "./lark-card.js";

function formatSession(session, index) {
  const date = session.updatedAt ? new Date(session.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
  return `${index}. **${session.title}**\n   ${session.id} · ${date}`;
}

function isRetryableSessionError(error) {
  return /(timed? out|timeout|temporar|reconnect|connection|network|transport|websocket|dns|no such host|econn|socket|rate.?limit|429|502|503|504)/i
    .test(String(error?.message || error));
}

function executorLabel(executor) {
  return executor === "claude" ? "Claude Code" : "Codex";
}

function executionChannel(job) {
  const requested = job.requestedExecutor || job.executor || "codex";
  const actual = job.actualExecutor || job.executor || requested;
  return requested === actual
    ? executorLabel(actual)
    : `${executorLabel(requested)} -> ${executorLabel(actual)} 兜底`;
}

export class Bridge {
  constructor({ config, sessions, state, lark, runner, followupManager = null, logger = console }) {
    this.config = config;
    this.sessions = sessions;
    this.state = state;
    this.lark = lark;
    this.runner = runner;
    this.followupManager = followupManager;
    this.logger = logger;
    this.draining = false;
  }

  async handle(event) {
    if (event.sender_id !== this.config.allowedOpenId || event.chat_type !== "p2p" || event.sender_type !== "user") return;
    if (event.message_type !== "text" && event.message_type !== "post") {
      await this.lark.reply(event.message_id, "目前只接受文字指令。", "unsupported");
      return;
    }
    if (this.state.hasProcessed(event.message_id)) return;
    if (this.state.state.queue.some((item) => item.id === event.message_id)) return;
    // A reply to an outstanding approval is a safety-state transition, not a
    // general intent category, so it remains program-enforced.
    if (await this.handleResearchConfirmation(event)) return;
    const controllerSessionId = this.state.state.controllerSessionId || this.state.state.currentSessionId;
    if (!controllerSessionId) {
      await this.lark.reply(event.message_id, "Codex 总控任务尚未绑定，请先在本机完成初始化。消息没有被标记为已处理。", "controller-missing");
      return;
    }
    this.state.state.controllerSessionId = controllerSessionId;
    await this.state.markProcessed(event.message_id);
    try {
      await this.enqueue(controllerSessionId, event.content, event, { controller: true });
    } catch (error) {
      // markProcessed prevents the Feishu event from duplicating the request;
      // enqueue persists before replying, so only failures before persistence
      // reach here and can safely be surfaced for manual retry.
      this.logger.error(error);
      await this.lark.reply(event.message_id, `交给 Codex 总控失败：\n\n${error.message}`, "controller-error");
    }
  }

  async handleCardAction(event) {
    if (event.operator_id !== this.config.allowedOpenId || !event.event_id) return;
    this.state.state.processedCardEventIds ??= [];
    if (this.state.state.processedCardEventIds.includes(event.event_id)) return;
    const action = (() => {
      try { return JSON.parse(event.action_value || "{}"); } catch { return {}; }
    })();
    const isFollowupAction = String(action.type || "").startsWith("followup_")
      || String(event.action_name || "").startsWith("followup_");
    if (isFollowupAction && this.followupManager) {
      await this.followupManager.handleCardAction(event, action);
      this.state.state.processedCardEventIds.push(event.event_id);
      await this.state.save();
      return;
    }
    let result = null;
    let tone = "green";
    if (action.type === "acknowledge") {
      result = String(action.message || "已确认收到。").slice(0, 500);
    } else if (action.type === "research_decision") {
      const item = (this.state.state.mentionResearchConfirmations || [])
        .find((entry) => entry.sourceMessageId === action.sourceMessageId && entry.status === "pending");
      if (!item) {
        result = "这项调研确认已经处理过或已失效。";
        tone = "grey";
      } else {
        await this.applyResearchDecision(item, action.decision === "approve" ? "approve" : "decline", action.channel);
        const channelName = item.task.researchChannel === "xiaowei" ? "智造湖小维" : "Codex";
        result = action.decision === "approve"
          ? `已确认启动调研：**${item.task.title}**\n\n通道：${channelName}。结果返回后会发给你并写回滴答任务。`
          : `已记录暂不调研：**${item.task.title}**\n\n对应的滴答待办会继续保留。`;
        tone = action.decision === "approve" ? "green" : "grey";
      }
    } else if (event.action_tag === "select_static" && event.action_name === "session_choice") {
      const sessionId = event.option;
      const allowed = this.state.state.lastCandidates.some((item) => item.id === sessionId);
      if (!allowed) throw new Error("所选会话已不在当前候选列表，请重新发起请求。");
      this.state.state.processedCardEventIds.push(event.event_id);
      await this.state.save();
      await this.lark.updateCard(event.token, buildNotificationCard("已收到你的选择，正在切换并继续处理。", {
        title: "会话已选择", tone: "green", status: "已处理",
      }));
      await this.select(sessionId, event.message_id);
      return;
    } else if (event.action_tag === "button" && event.form_value) {
      let values;
      try { values = JSON.parse(event.form_value); } catch { values = {}; }
      const prompt = String(values.prompt || "").trim();
      if (!prompt) throw new Error("没有收到有效的补充内容，请重新填写。");
      this.state.state.processedCardEventIds.push(event.event_id);
      await this.state.save();
      await this.lark.updateCard(event.token, buildNotificationCard(`已收到：${prompt}`, {
        title: "要求已提交", tone: "green", status: "已处理",
      }));
      const synthetic = { message_id: event.message_id, content: prompt };
      const controllerSessionId = this.state.state.controllerSessionId || this.state.state.currentSessionId;
      if (!controllerSessionId) throw new Error("Codex 总控任务尚未绑定。");
      await this.enqueue(controllerSessionId, prompt, synthetic, { controller: true });
      return;
    } else {
      result = "这个操作当前无法识别，请直接回复文字说明你的目标。";
      tone = "red";
    }
    this.state.state.processedCardEventIds.push(event.event_id);
    await this.state.save();
    await this.lark.updateCard(event.token, buildNotificationCard(result, {
      title: tone === "red" ? "操作未完成" : "操作已记录",
      tone,
      status: tone === "red" ? "需重试" : "已处理",
    }));
  }

  async handleResearchConfirmation(event) {
    const pending = (this.state.state.mentionResearchConfirmations || []).filter((item) => item.status === "pending");
    if (!pending.length) return false;
    const text = String(event.content || "").trim();
    const negative = /(先不|暂不|不用|不要|不需要|取消|跳过).{0,8}(调研|调查|查|启动)?/i.test(text);
    const positive = /(可以|确认|需要|开始|启动|继续|同意|查一下|调研|调查)/i.test(text);
    if (!negative && !positive) return false;
    let matches = pending.filter((item) =>
      (item.questionMessageId && event.reply_to === item.questionMessageId)
      || text.includes(item.task.taskId)
      || text.includes(item.task.taskId.slice(-8))
      || (item.task.title.length >= 4 && text.includes(item.task.title)),
    );
    if (!matches.length && pending.length === 1) matches = pending;
    await this.state.markProcessed(event.message_id);
    if (matches.length !== 1) {
      await this.lark.reply(
        event.message_id,
        `我识别到这是调研确认，但当前有 ${pending.length} 项等待决定。请带上事项名或确认编号：\n\n${pending.map((item) => `- ${item.task.title}（${item.task.taskId}）`).join("\n")}`,
        "research-confirm-ambiguous",
      );
      return true;
    }
    const item = matches[0];
    if (negative) {
      await this.applyResearchDecision(item, "decline");
      await this.lark.reply(event.message_id, `已记录：**${item.task.title}** 暂不启动调研，会保留滴答待办。`, "research-declined");
      return true;
    }
    const channel = /小维/.test(text) ? "xiaowei" : (item.task.researchChannel || "codex");
    await this.applyResearchDecision(item, "approve", channel);
    const channelName = channel === "xiaowei" ? "智造湖小维" : "Codex";
    await this.lark.reply(event.message_id, `已确认：**${item.task.title}**。将使用 ${channelName} 调研，结果返回后发给你并写回滴答任务。`, "research-approved");
    return true;
  }

  async applyResearchDecision(item, decision, channel = null) {
    item.status = decision === "approve" ? "approved" : "declined";
    item.decidedAt = new Date().toISOString();
    item.nextAttemptAt = null;
    if (decision === "approve") item.task.researchChannel = channel || item.task.researchChannel || "codex";
    if (decision === "decline") {
      this.state.state.researchDecisionHistory.push({
        at: item.decidedAt,
        title: item.task.title,
        suggestedDecision: item.task.researchDecision,
        finalDecision: "skip",
        reason: `用户决定暂不调研；原判断：${item.task.researchDecisionReason}`,
      });
      this.state.state.researchDecisionHistory = this.state.state.researchDecisionHistory.slice(-100);
    }
    await this.state.save();
  }

  async search(query, messageId, { autoSelectUnique = false } = {}) {
    const matches = await this.sessions.find(query, this.config.maxCandidates);
    this.state.state.lastCandidates = matches.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    await this.state.save();
    if (!matches.length) {
      await this.lark.reply(messageId, `没有找到与“${query}”匹配的会话。可以换标题关键词或直接使用 UUID。`, "search-none");
      return null;
    }
    if (autoSelectUnique && matches.length === 1) return matches[0];
    const body = matches.map(formatSession).join("\n\n");
    await this.lark.replySelection(
      messageId,
      `找到 ${matches.length} 个候选会话：\n\n${body}\n\n可直接在下方选择，也可以继续回复文字。`,
      matches.map((session) => ({ text: `${session.title} · ${shortId(session.id)}`, value: session.id })),
      { title: "选择 Codex 会话", tone: "yellow" },
      "search-results",
    );
    return null;
  }

  async select(selector, messageId) {
    let session = null;
    if (/^\d+$/.test(selector)) {
      session = this.state.state.lastCandidates[Number(selector) - 1] ?? null;
    } else {
      const matches = await this.sessions.find(selector, 2);
      if (matches.length === 1) session = matches[0];
      else if (matches.length > 1) return this.search(selector, messageId);
    }
    if (!session) return this.lark.reply(messageId, "无法唯一确定会话。请先发送“会话 关键词”查看候选列表。", "select-none");
    this.state.state.currentSessionId = session.id;
    const pendingPrompt = this.state.state.pendingPrompt;
    this.state.state.pendingPrompt = null;
    await this.state.save();
    if (pendingPrompt) {
      return this.enqueue(session.id, pendingPrompt, { message_id: messageId });
    }
    return this.lark.reply(messageId, `已切换到：**${session.title}**\n\n${session.id}\n\n后续普通消息会直接发送到这个会话。`, "selected");
  }

  async enqueue(sessionId, prompt, event, options = {}) {
    const session = await this.sessions.get(sessionId);
    if (!session) return this.lark.reply(event.message_id, "目标会话已不存在或不可续接，请重新搜索。", "missing");
    const ahead = this.state.state.queue.filter((job) => job.sessionId === sessionId).length;
    this.state.state.queue.push({
      id: event.message_id,
      sessionId,
      sessionTitle: session.title,
      prompt,
      receivedAt: new Date().toISOString(),
      executor: session.provider || "codex",
      requestedExecutor: session.provider || "codex",
      controller: Boolean(options.controller),
    });
    await this.state.save();
    const busy = this.runner.isRunning(sessionId) || ahead > 0;
    await this.lark.reply(event.message_id,
      busy
        ? `已交给 Codex 总控并加入队列。\n\n前面还有 ${ahead + 1} 个执行/等待中的要求。`
        : `已交给 Codex 总控直接理解并执行，我会把结果发回这里。`,
      "queued");
    void this.drain();
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.state.state.queue.length) {
        const now = Date.now();
        const runnableIndex = this.state.state.queue.findIndex((job) => (
          !this.runner.isRunning(job.sessionId)
          && (!job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now)
        ));
        if (runnableIndex < 0) break;
        const job = this.state.state.queue[runnableIndex];
        job.requestedExecutor ||= job.executor || "codex";
        job.executor ||= job.requestedExecutor;

        if (job.finalResult) {
          try {
            const failureRecord = job.failureReason
              ? `\n\n失败记录：${job.failureReason}（${job.failureStage || "未知阶段"}）`
              : "";
            await this.lark.send(
              `**${job.sessionTitle}**（${shortId(job.sessionId)}）处理完成**\n\n执行通道：${executionChannel(job)}${failureRecord}\n\n${job.finalResult}`,
              `${job.id}:final`,
            );
            this.recordExecution(job, "completed");
            this.state.state.queue.splice(runnableIndex, 1);
            await this.state.save();
          } catch (error) {
            await this.retainForRetry(job, error, "结果回传");
            break;
          }
          continue;
        }

        try {
          const final = await this.runner.execute(job, (message) => this.lark.send(
            `**${job.sessionTitle}**（${shortId(job.sessionId)}）\n\n${message}`,
            `${job.id}:progress`,
          ));
          job.finalResult = final;
          job.actualExecutor = job.executor || job.requestedExecutor;
          if (job.actualExecutor !== job.requestedExecutor) {
            job.fallbackUsed = true;
            job.failureReason ||= "executor_fallback";
            job.failureStage ||= "会话执行";
          }
          delete job.nextAttemptAt;
          delete job.lastError;
          await this.state.save();
        } catch (error) {
          if (error instanceof SessionBusyError) {
            job.nextAttemptAt = new Date(Date.now() + 15_000).toISOString();
            job.lastError = error.message;
            job.failureReason = "session_busy";
            job.failureStage = "会话执行";
            await this.state.save();
            await this.lark.send(
              `**${job.sessionTitle}**（${shortId(job.sessionId)}）当前正在执行其他任务，要求已保留在队列，稍后自动重试。`,
              `${job.id}:busy`,
            );
            break;
          }
          if (isRetryableSessionError(error)) {
            await this.retainForRetry(job, error, "会话执行");
            break;
          }
          job.actualExecutor = job.executor || job.requestedExecutor;
          job.failureReason = "executor_error";
          job.failureStage = "会话执行";
          this.recordExecution(job, "failed");
          this.state.state.queue.splice(runnableIndex, 1);
          await this.state.save();
          try {
            await this.lark.send(`**${job.sessionTitle}**（${shortId(job.sessionId)}）执行失败**\n\n${error.message}`, `${job.id}:failed`);
          } catch (sendError) {
            this.logger.error("failed to report terminal session error", sendError);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async retainForRetry(job, error, stage) {
    job.attempts = (job.attempts || 0) + 1;
    job.lastError = String(error?.message || error).slice(-4000);
    job.failureReason = stage === "结果回传" ? "result_delivery" : "retryable_transient";
    job.failureStage = stage;
    const baseMs = this.config.sessionRetryBaseMs || 30_000;
    const maxMs = this.config.sessionRetryMaxMs || 300_000;
    const delayMs = Math.min(maxMs, baseMs * (2 ** Math.min(job.attempts - 1, 6)));
    job.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    await this.state.save();
    this.logger.error(`${stage} failed; retained for retry`, error);
    if (job.attempts === 1 || job.attempts % 5 === 0) {
      try {
        await this.lark.send(
          `**${job.sessionTitle}**（${shortId(job.sessionId)}）${stage}暂时失败，要求仍保留在队列。\n\n将在约 ${Math.ceil(delayMs / 1000)} 秒后自动重试。`,
          `${job.id}:retry:${job.attempts}`,
        );
      } catch {}
    }
  }

  recordExecution(job, status) {
    const history = this.state.state.executionHistory ||= [];
    history.push({
      id: job.id,
      sessionId: job.sessionId,
      requestedExecutor: job.requestedExecutor || job.executor || "codex",
      actualExecutor: job.actualExecutor || job.executor || job.requestedExecutor || "codex",
      fallbackUsed: Boolean(job.fallbackUsed),
      failureReason: job.failureReason || null,
      failureStage: job.failureStage || null,
      status,
      completedAt: new Date().toISOString(),
    });
    if (history.length > 200) history.splice(0, history.length - 200);
  }

  async retryQueued() {
    if (this.state.state.queue.length) await this.drain();
  }

}
