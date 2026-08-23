import { createHash } from "node:crypto";
import { isLowSignalAcknowledgement, isSyntheticTestMessage } from "./mention-monitor.js";

function isoWithOffset(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

function normalizeEventTime(value) {
  if (typeof value === "number" || /^\d{10,13}$/.test(String(value || ""))) {
    const numeric = Number(value);
    return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
  }
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function addBusinessDays(date, count) {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const result = new Date(date.getTime() + chinaOffsetMs);
  let remaining = Math.max(0, Number(count) || 0);
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return new Date(result.getTime() - chinaOffsetMs);
}

export function extractReactionRecords(reactions) {
  const found = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const operator = value.operator;
    const operatorId = operator?.operator_id || value.user_id?.open_id || value.operator_id;
    const emojiType = value.emoji_type || value.reaction_type?.emoji_type;
    if (operatorId && emojiType) {
      found.push({
        operatorId,
        operatorType: operator?.operator_type || value.operator_type || "user",
        emojiType,
        actionTime: value.action_time || null,
        reactionId: value.reaction_id || null,
      });
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(reactions?.details ?? reactions);
  return found;
}

function reactionStateKey(messageId, operatorId, emojiType) {
  return `${messageId}:${operatorId}:${emojiType}`;
}

export class OwnerEngagementMonitor {
  constructor({ config, state, lark, mentionMonitor, collaborationLearning = null, logger = console }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.mentionMonitor = mentionMonitor;
    this.collaborationLearning = collaborationLearning;
    this.logger = logger;
    this.polling = false;
    this.processingReactions = false;
  }

  initializeState() {
    this.state.state.ownerEngagedConversations ??= [];
    this.state.state.ownerEngagementProcessedMessageIds ??= [];
    this.state.state.reactionPendingEvents ??= [];
    this.state.state.reactionProcessedEventIds ??= [];
    this.state.state.reactionStates ??= {};
  }

  activeEngagements(now = new Date()) {
    this.initializeState();
    this.state.state.ownerEngagedConversations = this.state.state.ownerEngagedConversations
      .filter((item) => new Date(item.expiresAt) > now);
    return this.state.state.ownerEngagedConversations;
  }

  upsertEngagement(message, now = new Date()) {
    if (!message.chat_id) return;
    const duration = Number(this.config.ownerEngagementBusinessDays ?? 3);
    const current = this.state.state.ownerEngagedConversations.find((item) => item.chatId === message.chat_id);
    const next = {
      chatId: message.chat_id,
      chatName: message.chat_name || current?.chatName || message.chat_id,
      chatType: message.chat_type || current?.chatType || "group",
      startedAt: current?.startedAt || now.toISOString(),
      lastOwnerActivityAt: message.create_time || now.toISOString(),
      lastOwnerMessageId: message.message_id,
      expiresAt: addBusinessDays(now, duration).toISOString(),
    };
    if (current) Object.assign(current, next);
    else this.state.state.ownerEngagedConversations.push(next);
  }

  async recordOwnerMessage(message, now = new Date()) {
    this.initializeState();
    if (!message?.message_id || !message?.chat_id || message.deleted === true) return false;
    if (message.sender?.id !== this.config.allowedOpenId) return false;
    if (this.state.state.processedMessageIds?.includes(message.message_id)) return false;
    const controlChatIds = new Set([
      ...(this.config.ownerControlChatIds || []),
      ...(this.state.state.ownerControlChatIds || []),
    ]);
    if (controlChatIds.has(message.chat_id)) return false;
    if (message.chat_id === this.config.xiaoweiAgent?.chatId) return false;
    if (this.state.state.ownerEngagementProcessedMessageIds.includes(message.message_id)) return false;
    this.upsertEngagement(message, now);
    this.state.state.ownerEngagementProcessedMessageIds.push(message.message_id);
    if (this.collaborationLearning) {
      await this.collaborationLearning.recordOwnerSignal({
        type: "business_participation",
        chatId: message.chat_id,
        messageId: message.message_id,
        chatType: message.chat_type || null,
        hasReplyLink: Boolean(message.reply_to || message.root_id || message.thread_id),
      }, now);
    }
    if (isLowSignalAcknowledgement(message.content) || isSyntheticTestMessage(message.content)) {
      await this.state.save();
      return true;
    }
    await this.mentionMonitor.enqueueSignal({
      ...message,
      sender: { ...(message.sender || {}), id: this.config.allowedOpenId, name: this.config.ownerName || "常东旭" },
      intakeReasons: ["本人主动参与工作沟通"],
      collaborationSignal: { type: "business_participation" },
    }, Number(this.config.ownerEngagementSettleDelayMs ?? 10 * 60_000));
    return true;
  }

  async ingestReaction(payload, operation) {
    this.initializeState();
    const event = payload?.event || {};
    const header = payload?.header || {};
    if (!header.event_id || !event.message_id || !event.user_id?.open_id || !event.reaction_type?.emoji_type) return false;
    if (this.state.state.reactionProcessedEventIds.includes(header.event_id)
      || this.state.state.reactionPendingEvents.some((item) => item.eventId === header.event_id)) return false;
    this.state.state.reactionPendingEvents.push({
      eventId: header.event_id,
      operation,
      messageId: event.message_id,
      operatorId: event.user_id.open_id,
      operatorType: event.operator_type || "user",
      emojiType: event.reaction_type.emoji_type,
      occurredAt: normalizeEventTime(event.action_time || header.create_time),
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
    await this.state.save();
    await this.processReactionQueue();
    return true;
  }

  async processReactionQueue() {
    if (this.processingReactions) return;
    this.processingReactions = true;
    try {
      this.initializeState();
      for (let index = 0; index < this.state.state.reactionPendingEvents.length;) {
        const pending = this.state.state.reactionPendingEvents[index];
        if (pending.nextAttemptAt && new Date(pending.nextAttemptAt) > new Date()) { index += 1; continue; }
        try {
          const [target] = await this.lark.getMessagesByIds([pending.messageId]);
          if (!target) throw new Error("飞书表情目标消息不可见");
          if (!target.chat_id) throw new Error("飞书表情目标消息缺少会话标识");
          if (!target.chat_type) {
            target.chat_type = (this.state.state.groupMembershipKnownChatIds || []).includes(target.chat_id)
              ? "group" : "p2p";
          }
          if (!target.chat_name) {
            target.chat_name = this.state.state.ownerEngagedConversations
              .find((item) => item.chatId === target.chat_id)?.chatName || target.chat_id;
          }
          const relevant = pending.operatorId === this.config.allowedOpenId
            || target.sender?.id === this.config.allowedOpenId;
          if (relevant) await this.enqueueReactionSignal(target, pending);
          this.state.state.reactionProcessedEventIds.push(pending.eventId);
          this.state.state.reactionPendingEvents.splice(index, 1);
          await this.state.save();
        } catch (error) {
          pending.attempts += 1;
          pending.lastError = String(error?.message || error).slice(-1000);
          const delayMinutes = Math.min(60, 2 ** Math.min(pending.attempts, 6));
          pending.nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
          await this.state.save();
          this.logger.error("reaction signal processing failed", error);
          index += 1;
        }
      }
    } finally {
      this.processingReactions = false;
    }
  }

  async enqueueReactionSignal(target, signal) {
    const ownerOperated = signal.operatorId === this.config.allowedOpenId;
    const operationText = signal.operation === "deleted" ? "撤销了" : "添加了";
    const relationText = ownerOperated ? "本人表情回应" : "他人回应本人消息";
    const targetText = String(target.content || "").slice(0, 1500);
    const stateKey = reactionStateKey(signal.messageId, signal.operatorId, signal.emojiType);
    if (signal.operation === "deleted") delete this.state.state.reactionStates[stateKey];
    else this.state.state.reactionStates[stateKey] = {
      messageId: signal.messageId,
      operatorId: signal.operatorId,
      emojiType: signal.emojiType,
      lastAt: signal.occurredAt,
    };
    if (ownerOperated && this.collaborationLearning) {
      await this.collaborationLearning.recordOwnerSignal({
        type: "reaction",
        operation: signal.operation,
        emojiType: signal.emojiType,
        messageId: signal.messageId,
        chatId: target.chat_id || null,
      }, new Date(signal.occurredAt));
    }
    return this.mentionMonitor.enqueueSignal({
      message_id: `reaction:${signal.eventId}`,
      chat_id: target.chat_id,
      chat_name: target.chat_name || target.chat_id,
      chat_type: target.chat_type || "group",
      create_time: signal.occurredAt,
      content: `${ownerOperated ? (this.config.ownerName || "常东旭") : "他人"}对${ownerOperated ? "目标消息" : (this.config.ownerName || "常东旭") + "的消息"}${operationText}表情「${signal.emojiType}」。表情只是上下文信号，必须结合目标消息、会话习惯和附近上下文判断是确认、知晓、跟进、异议、撤回还是社交回应；不得使用固定 emoji 字典机械下结论。\n\n目标消息：${targetText}`,
      sender: {
        id: signal.operatorId,
        name: ownerOperated ? (this.config.ownerName || "常东旭") : signal.operatorId,
      },
      reply_to: signal.messageId,
      root_id: target.root_id || null,
      thread_id: target.thread_id || null,
      intakeReasons: [relationText, signal.operation === "deleted" ? "表情撤回" : "表情新增"],
      collaborationSignal: {
        type: "reaction",
        operation: signal.operation,
        emojiType: signal.emojiType,
        ownerOperated,
      },
      message_app_link: target.message_app_link || `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(target.chat_id || "")}&position=${encodeURIComponent(signal.messageId)}`,
    }, Number(this.config.reactionSettleDelayMs ?? 2 * 60_000));
  }

  async reconcileMessageReactions(message, now = new Date()) {
    for (const reaction of extractReactionRecords(message.reactions)) {
      if (reaction.operatorType !== "user") continue;
      if (reaction.operatorId !== this.config.allowedOpenId && message.sender?.id !== this.config.allowedOpenId) continue;
      const key = reactionStateKey(message.message_id, reaction.operatorId, reaction.emojiType);
      if (this.state.state.reactionStates[key]) continue;
      const eventId = `snapshot:${createHash("sha256").update(`${key}:${reaction.actionTime || reaction.reactionId || "present"}`).digest("hex").slice(0, 24)}`;
      await this.enqueueReactionSignal(message, {
        eventId,
        operation: "created",
        messageId: message.message_id,
        operatorId: reaction.operatorId,
        operatorType: reaction.operatorType,
        emojiType: reaction.emojiType,
        occurredAt: normalizeEventTime(reaction.actionTime || now),
      });
    }
  }

  async poll(now = new Date()) {
    if (this.polling || this.config.ownerEngagementEnabled === false) return;
    const intervalMs = Number(this.config.ownerEngagementPollIntervalMs || 30 * 60_000);
    if (this.state.state.ownerEngagementLastPollAt
      && now - new Date(this.state.state.ownerEngagementLastPollAt) < intervalMs) return;
    this.polling = true;
    try {
      this.initializeState();
      const previous = this.state.state.ownerEngagementLastPollAt
        ? new Date(this.state.state.ownerEngagementLastPollAt)
        : new Date(now.getTime() - Number(this.config.ownerEngagementInitialLookbackMinutes || 30) * 60_000);
      const overlapMs = Number(this.config.ownerEngagementOverlapMinutes || 10) * 60_000;
      const ownerMessages = await this.lark.searchOwnerMessages(
        isoWithOffset(new Date(previous.getTime() - overlapMs)), isoWithOffset(now),
      );
      for (const message of ownerMessages) {
        await this.recordOwnerMessage(message, now);
        await this.reconcileMessageReactions(message, now);
      }
      const active = this.activeEngagements(now);
      if (active.length) {
        const fallbackHours = Number(this.config.reactionFallbackLookbackHours || 24);
        const scanStart = new Date(now.getTime() - fallbackHours * 60 * 60_000);
        const messages = await this.lark.searchEngagedConversationMessages(
          isoWithOffset(scanStart), isoWithOffset(now), active.map((item) => item.chatId),
        );
        for (const message of messages) await this.reconcileMessageReactions(message, now);
      }
      this.state.state.ownerEngagementLastPollAt = now.toISOString();
      this.state.state.ownerEngagementHealthFailure = null;
      await this.state.save();
      await this.processReactionQueue();
    } catch (error) {
      const failure = this.state.state.ownerEngagementHealthFailure || { at: now.toISOString(), attempts: 0 };
      failure.attempts += 1;
      failure.lastAt = now.toISOString();
      failure.lastError = String(error?.message || error).slice(-1000);
      this.state.state.ownerEngagementHealthFailure = failure;
      await this.state.save();
      this.logger.error("owner engagement poll failed", error);
    } finally {
      this.polling = false;
    }
  }
}
