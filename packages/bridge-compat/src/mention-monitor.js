import { formatUserTime } from "./util.js";

function isoWithOffset(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

function userFacingError(error) {
  const text = String(error?.message || error || "未知错误");
  if (/Invalid schema for response_format[\s\S]*uniqueItems/i.test(text)) {
    return "滴答任务输出格式校验失败：标签 Schema 包含当前 Codex 不支持的 uniqueItems。";
  }
  if (/request timed out|请求超时|执行超过.+秒/i.test(text)) {
    return "Codex 或滴答 MCP 请求超时，后台将自动重试。";
  }
  if (/missing required scope|missing_scope/i.test(text)) {
    return "飞书或滴答连接缺少所需权限，详细信息已保留在本地日志。";
  }
  const exitCode = text.match(/exit\s+(\d+)/i)?.[1];
  return `后台执行失败${exitCode ? `（exit ${exitCode}）` : ""}，详细信息已保留在本地日志。`;
}

export function isLarkRateLimitError(error) {
  const text = String(error?.message || error || "");
  return /"code"\s*:\s*9499\b|too many request/i.test(text);
}

const LOW_SIGNAL_ACKNOWLEDGEMENTS = new Set([
  "ok", "okay", "好的", "好", "收到", "收到啦", "明白", "明白了", "了解", "知道了",
]);

export function isLowSignalAcknowledgement(content) {
  const normalized = String(content ?? "")
    .normalize("NFKC")
    .replace(/<at\b[^>]*>.*?<\/at>/giu, " ")
    .replace(/^@\S+\s*/u, "")
    .trim()
    .toLowerCase()
    .replace(/[\s!！。.,，~～]+/gu, "");
  return LOW_SIGNAL_ACKNOWLEDGEMENTS.has(normalized);
}

export function isSyntheticTestMessage(content) {
  const normalized = String(content ?? "")
    .normalize("NFKC")
    .replace(/<at\b[^>]*>.*?<\/at>/giu, " ")
    .replace(/^@\S+\s*/u, "")
    .trim()
    .toLowerCase()
    .replace(/[!！。.,，~～]+$/gu, "")
    .trim();
  return /^(?:测试|测试任务|测试消息|联调测试|自动化测试|test|test task|test message|smoke test)(?:\s*(?:勿回|请忽略|ignore))?$/iu.test(normalized);
}

export function isDelegationJoinSystemMessage(message, inviterName = "任永强", ownerName = "常东旭") {
  if (message?.msg_type !== "system") return false;
  const content = String(message.content || "").normalize("NFKC");
  return content.includes(inviterName)
    && (content.includes(ownerName) || content.includes("你"))
    && /(邀请|添加|拉).{0,20}(加入|进).{0,12}(群|会话)|加入了群聊/u.test(content);
}

function normalizeEventTime(value) {
  if (typeof value === "number" || /^\d{10,13}$/.test(String(value || ""))) {
    const numeric = Number(value);
    return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
  }
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export class MentionMonitor {
  constructor({ config, state, lark, taskCreator, runner = null, xiaoweiResearch = null, shadowCollaboration = null, collaborationLearning = null, policyManager = null, logger = console }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.taskCreator = taskCreator;
    this.runner = runner;
    this.xiaoweiResearch = xiaoweiResearch;
    this.shadowCollaboration = shadowCollaboration;
    this.collaborationLearning = collaborationLearning;
    this.policyManager = policyManager;
    this.logger = logger;
    this.polling = false;
    this.localProcessing = false;
    this.digestFlushing = false;
  }

  initializeState() {
    this.state.state.mentionClarifications ??= [];
    this.state.state.mentionResearchSessions ??= [];
    this.state.state.mentionResearchConfirmations ??= [];
    this.state.state.researchDecisionHistory ??= [];
    this.state.state.flaggedConversationChatIds ??= [];
    this.state.state.mentionPending ??= [];
    this.state.state.mentionProcessedMessageIds ??= [];
    this.state.state.mentionProcessingFailure ??= null;
    this.state.state.delegatedGroupChatIds ??= [];
    this.state.state.groupMembershipKnownChatIds ??= [];
  }

  async ingestMembershipAdded(payload) {
    const event = payload?.event || {};
    const header = payload?.header || {};
    const inviter = this.config.delegationInviter;
    if (!inviter?.openId || event.operator_id?.open_id !== inviter.openId) return false;
    if (!(event.users || []).some((user) => user.user_id?.open_id === this.config.allowedOpenId)) return false;
    return this.ingestDelegationSignal({
      eventId: header.event_id || `membership:${event.chat_id}:${header.create_time || Date.now()}`,
      chatId: event.chat_id,
      chatName: event.name || event.i18n_names?.zh_cn || event.chat_id,
      external: event.external === true,
      occurredAt: normalizeEventTime(header.create_time),
      evidence: "飞书成员加入实时事件精确确认邀请人与被邀请人",
    });
  }

  async ingestDelegationSignal({ eventId, chatId, chatName, external = false, occurredAt, evidence }) {
    this.initializeState();
    if (!eventId || !chatId) return false;
    const messageId = String(eventId).startsWith("om_") ? eventId : `membership:${eventId}`;
    const exists = this.state.state.mentionProcessedMessageIds.includes(messageId)
      || this.state.state.mentionPending.some((item) => item.message.message_id === messageId);
    if (!this.state.state.delegatedGroupChatIds.includes(chatId)) this.state.state.delegatedGroupChatIds.push(chatId);
    if (!this.state.state.groupMembershipKnownChatIds.includes(chatId)) this.state.state.groupMembershipKnownChatIds.push(chatId);
    if (exists) {
      await this.state.save();
      return false;
    }
    const inviter = this.config.delegationInviter;
    const settleDelayMs = Number(this.config.groupMembershipSettleDelayMs ?? 10 * 60_000);
    this.state.state.mentionPending.push({
      message: {
        message_id: messageId,
        chat_id: chatId,
        chat_name: chatName,
        chat_type: "group",
        create_time: occurredAt || new Date().toISOString(),
        content: `${inviter?.name || "任永强"}邀请常东旭加入群聊「${chatName}」。这通常表示需要常东旭接手或分担相关工作；必须结合群内上下文确认具体责任、现状和下一步。核验依据：${evidence}。`,
        sender: { id: inviter?.openId, name: inviter?.name || "任永强" },
        external,
        intakeReasons: ["任永强邀请入群：工作接手"],
        message_app_link: `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(chatId)}`,
      },
      discoveredAt: new Date().toISOString(),
      readyAt: settleDelayMs > 0 ? new Date(Date.now() + settleDelayMs).toISOString() : null,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
    await this.state.save();
    await this.processLocalQueues();
    return true;
  }

  async syncGroupMemberships(now = new Date()) {
    if (this.config.groupMembershipMonitorEnabled === false || !this.lark.listGroupChats) return;
    const intervalMs = Number(this.config.groupMembershipSyncIntervalMs || 30 * 60_000);
    const lastSyncAt = this.state.state.groupMembershipLastSyncAt
      ? new Date(this.state.state.groupMembershipLastSyncAt).getTime() : 0;
    if (lastSyncAt && now.getTime() - lastSyncAt < intervalMs) return;
    try {
      const chats = await this.lark.listGroupChats();
      const known = new Set(this.state.state.groupMembershipKnownChatIds || []);
      if (!known.size && !this.state.state.groupMembershipLastSyncAt) {
        this.state.state.groupMembershipKnownChatIds = chats.map((chat) => chat.chat_id).filter(Boolean);
        this.state.state.groupMembershipLastSyncAt = now.toISOString();
        this.state.state.groupMembershipHealthFailure = null;
        await this.state.save();
        return;
      }
      const newChats = chats.filter((chat) => chat.chat_id && !known.has(chat.chat_id));
      const start = this.state.state.groupMembershipLastSyncAt
        ? new Date(new Date(this.state.state.groupMembershipLastSyncAt).getTime() - 10 * 60_000).toISOString()
        : new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
      for (const chat of newChats) {
        const messages = await this.lark.getChatMessagesSince(chat.chat_id, start);
        const evidence = [...messages].reverse().find((message) => isDelegationJoinSystemMessage(
          message, this.config.delegationInviter?.name || "任永强", this.config.ownerName || "常东旭",
        ));
        if (evidence) {
          await this.ingestDelegationSignal({
            eventId: evidence.message_id,
            chatId: chat.chat_id,
            chatName: chat.name || chat.chat_id,
            external: chat.external === true,
            occurredAt: evidence.create_time || now.toISOString(),
            evidence: "本人群列表差分及系统入群消息双重确认",
          });
        }
      }
      this.state.state.groupMembershipKnownChatIds = chats.map((chat) => chat.chat_id).filter(Boolean);
      this.state.state.groupMembershipLastSyncAt = now.toISOString();
      this.state.state.groupMembershipHealthFailure = null;
      await this.state.save();
    } catch (error) {
      const failure = this.state.state.groupMembershipHealthFailure || { at: now.toISOString(), attempts: 0 };
      failure.attempts += 1;
      failure.lastError = String(error?.message || error).slice(-1000);
      failure.lastAt = now.toISOString();
      this.state.state.groupMembershipHealthFailure = failure;
      await this.state.save();
      this.logger.error("group membership fallback sync failed", error);
    }
  }

  async ingestRealtime(event) {
    this.initializeState();
    if (event.chat_type !== "group" || event.sender_type !== "user" || event.sender_id === this.config.allowedOpenId) return false;
    const explicitlyMentioned = (event.mentions || []).some((mention) => mention.id === this.config.allowedOpenId);
    if (!explicitlyMentioned || !event.message_id) return false;
    const message = {
      message_id: event.message_id,
      chat_id: event.chat_id,
      chat_type: event.chat_type,
      create_time: event.create_time || event.timestamp || new Date().toISOString(),
      content: event.content,
      reply_to: event.reply_to || null,
      root_id: event.root_id || null,
      thread_id: event.thread_id || null,
      mentions: event.mentions || [],
      sender: { id: event.sender_id, name: event.sender_name || null },
      intakeReasons: ["@常东旭"],
    };
    if (isLowSignalAcknowledgement(message.content) || isSyntheticTestMessage(message.content)) {
      if (!this.state.state.mentionProcessedMessageIds.includes(message.message_id)) {
        this.state.state.mentionProcessedMessageIds.push(message.message_id);
        await this.state.save();
      }
      return false;
    }
    const exists = this.state.state.mentionProcessedMessageIds.includes(message.message_id)
      || this.state.state.mentionPending.some((item) => item.message.message_id === message.message_id);
    if (exists) return false;
    const settleDelayMs = Number(this.config.mentionRealtimeSettleDelayMs || 0);
    this.state.state.mentionPending.push({
      message,
      discoveredAt: new Date().toISOString(),
      readyAt: settleDelayMs > 0 ? new Date(Date.now() + settleDelayMs).toISOString() : null,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
    await this.state.save();
    await this.processLocalQueues();
    return true;
  }

  async enqueueSignal(message, settleDelayMs = 0) {
    this.initializeState();
    if (!message?.message_id || !message?.chat_id) return false;
    const exists = this.state.state.mentionProcessedMessageIds.includes(message.message_id)
      || this.state.state.mentionPending.some((item) => item.message.message_id === message.message_id);
    if (exists) return false;
    this.state.state.mentionPending.push({
      message,
      discoveredAt: new Date().toISOString(),
      readyAt: settleDelayMs > 0 ? new Date(Date.now() + settleDelayMs).toISOString() : null,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
    await this.state.save();
    await this.processLocalQueues();
    return true;
  }

  async processLocalQueues() {
    if (this.localProcessing) return;
    this.localProcessing = true;
    try {
      this.initializeState();
      await this.discardLowSignalPending();
      await this.processPending();
      await this.processApprovedResearch();
      await this.processClarificationReplies();
    } finally {
      this.localProcessing = false;
    }
  }

  async poll() {
    if (this.polling) return;
    if (this.state.state.mentionNextPollAt && new Date(this.state.state.mentionNextPollAt) > new Date()) return;
    this.polling = true;
    try {
      this.initializeState();
      const now = new Date();
      await this.syncFlaggedConversations(now);
      await this.syncGroupMemberships(now);
      const previous = this.state.state.mentionLastPollAt
        ? new Date(this.state.state.mentionLastPollAt)
        : new Date(now.getTime() - this.config.mentionInitialLookbackMinutes * 60_000);
      const start = new Date(previous.getTime() - this.config.mentionOverlapMinutes * 60_000);
      const startText = isoWithOffset(start);
      const endText = isoWithOffset(now);
      // The message-search endpoint has a low burst limit. Keep the independent
      // intake lanes sequential so one poll cannot create a four-request spike.
      const mentions = await this.lark.searchMentions(startText, endText);
      const specialAttention = await (this.lark.searchSpecialAttentionMessages?.(startText, endText) ?? []);
      const directMessages = await (this.lark.searchDirectMessages?.(startText, endText) ?? []);
      const flaggedConversationMessages = await (this.lark.searchFlaggedConversationMessages?.(
        startText, endText, this.state.state.flaggedConversationChatIds,
      ) ?? []);
      const delegatedGroupMessages = await (this.lark.searchDelegatedGroupMessages?.(
        startText, endText, this.state.state.delegatedGroupChatIds,
      ) ?? []);
      const specialIds = new Set((this.config.specialAttentionUsers || []).map((user) => user.openId));
      const foundById = new Map();
      const lowSignalIds = new Set();
      const addFound = (message, reason) => {
        if (!message.message_id || message.deleted === true || message.sender?.id === this.config.allowedOpenId) return;
        if (message.sender?.id === this.config.xiaoweiAgent?.openId) return;
        if (isLowSignalAcknowledgement(message.content) || isSyntheticTestMessage(message.content)) {
          lowSignalIds.add(message.message_id);
          return;
        }
        const existing = foundById.get(message.message_id);
        if (existing) {
          if (!existing.intakeReasons.includes(reason)) existing.intakeReasons.push(reason);
          return;
        }
        foundById.set(message.message_id, { ...message, intakeReasons: [reason] });
      };
      for (const message of mentions) addFound(message, "@常东旭");
      for (const message of specialAttention) {
        if (message.chat_type === "group" && specialIds.has(message.sender?.id)) {
          const person = (this.config.specialAttentionUsers || []).find((user) => user.openId === message.sender?.id);
          addFound(message, `特别关注：${person?.name || message.sender?.name || "关注联系人"}`);
        }
      }
      for (const message of directMessages) {
        if (message.chat_type === "p2p") addFound(message, "他人私聊");
      }
      for (const message of flaggedConversationMessages) addFound(message, "飞书标记会话");
      for (const message of delegatedGroupMessages) addFound(message, "任永强交接群");
      const processed = new Set(this.state.state.mentionProcessedMessageIds);
      for (const messageId of lowSignalIds) {
        if (!processed.has(messageId)) {
          this.state.state.mentionProcessedMessageIds.push(messageId);
          processed.add(messageId);
        }
      }
      const pendingIds = new Set(this.state.state.mentionPending.map((item) => item.message.message_id));
      for (const message of foundById.values()) {
        if (!message.message_id || processed.has(message.message_id) || pendingIds.has(message.message_id)) continue;
        if (message.sender?.id === this.config.allowedOpenId) continue;
        const discoveredAt = new Date().toISOString();
        const settleDelayMs = Number(this.config.mentionSettleDelayMs || 0);
        this.state.state.mentionPending.push({
          message,
          discoveredAt,
          readyAt: settleDelayMs > 0 ? new Date(Date.now() + settleDelayMs).toISOString() : null,
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
        });
        pendingIds.add(message.message_id);
      }
      this.state.state.mentionLastPollAt = now.toISOString();
      await this.state.save();
      await this.processLocalQueues();
      const rateLimitFailure = this.state.state.mentionRateLimitFailure;
      this.state.state.mentionRateLimitFailure = null;
      this.state.state.mentionNextPollAt = null;
      if (rateLimitFailure) await this.state.save();
      if (rateLimitFailure?.notifiedAt) {
        await this.safeSend(
          `飞书重点消息搜索限流已恢复。故障始于：${formatUserTime(rateLimitFailure.at, this.config.notificationTimeZone)}（北京时间）`,
          `mention-rate-limit-recovered:${rateLimitFailure.at}`,
        );
      }
      if (this.state.state.mentionHealthFailure) {
        const failure = this.state.state.mentionHealthFailure;
        const failedAt = failure.at;
        const recoveredNotified = await this.safeSendStatus(
          failure.notifiedAt
            ? `飞书重点消息监控已恢复。故障始于：${formatUserTime(failedAt, this.config.notificationTimeZone)}（北京时间）`
            : `飞书重点消息监控曾发生异常，现已恢复。故障始于：${formatUserTime(failedAt, this.config.notificationTimeZone)}（北京时间）。故障期间通知因飞书连接不可用未能送达，现已补发。`,
          `mention-recovered:${failedAt}`,
        );
        if (recoveredNotified) {
          this.state.state.mentionHealthFailure = null;
          await this.state.save();
        }
      }
    } catch (error) {
      this.logger.error("mention poll failed", error);
      if (isLarkRateLimitError(error)) {
        await this.handleRateLimit(error);
        return;
      }
      if (!this.state.state.mentionHealthFailure) {
        this.state.state.mentionHealthFailure = { at: new Date().toISOString(), error: error.message, notifiedAt: null };
        await this.state.save();
      }
      if (!this.state.state.mentionHealthFailure.notifiedAt) {
        const sent = await this.safeSendStatus(`飞书重点消息监控异常，后台会持续重试；如果飞书连接本身不可用，会在恢复后补发通知。\n\n${userFacingError(error)}`, `mention-failed:${this.state.state.mentionHealthFailure.at}`);
        if (sent) {
          this.state.state.mentionHealthFailure.notifiedAt = new Date().toISOString();
          await this.state.save();
        }
      }
    } finally {
      this.polling = false;
    }
  }

  async handleRateLimit(error, now = new Date()) {
    const failure = this.state.state.mentionRateLimitFailure ?? {
      at: now.toISOString(), attempts: 0, notifiedAt: null,
    };
    failure.attempts += 1;
    failure.error = String(error?.message || error).slice(-2000);
    failure.lastAt = now.toISOString();
    const baseMs = Number(this.config.mentionRateLimitBaseMs || 120000);
    const maxMs = Number(this.config.mentionRateLimitMaxMs || 1800000);
    const delayMs = Math.min(maxMs, baseMs * (2 ** Math.min(failure.attempts - 1, 6)));
    this.state.state.mentionRateLimitFailure = failure;
    this.state.state.mentionNextPollAt = new Date(now.getTime() + delayMs).toISOString();
    const notifyAfterMs = Number(this.config.mentionRateLimitNotifyAfterMs || 1800000);
    const sustained = now.getTime() - new Date(failure.at).getTime() >= notifyAfterMs;
    await this.state.save();
    if (sustained && !failure.notifiedAt) {
      failure.notifiedAt = now.toISOString();
      await this.state.save();
      await this.safeSend(
        `飞书重点消息搜索持续受到 OpenAPI 限流，实时消息和卡片事件监听仍在线，后台已自动降频重试。\n\n首次发生：${formatUserTime(failure.at, this.config.notificationTimeZone)}（北京时间）\n下次重试：${formatUserTime(this.state.state.mentionNextPollAt, this.config.notificationTimeZone)}（北京时间）`,
        `mention-rate-limit:${failure.at}`,
      );
    }
  }

  async processPending() {
    for (let index = 0; index < this.state.state.mentionPending.length;) {
      const pending = this.state.state.mentionPending[index];
      if (pending.readyAt && new Date(pending.readyAt) > new Date()) { index += 1; continue; }
      if (pending.nextAttemptAt && new Date(pending.nextAttemptAt) > new Date()) { index += 1; continue; }
      try {
        const context = await this.lark.getMentionContext(pending.message, this.config.mentionContextMinutes);
        const task = await this.taskCreator.createFromMention(
          pending.message,
          context,
          this.state.state.researchDecisionHistory,
          this.collaborationLearning?.guidanceFor?.(pending.message) || "暂无协作模式样本。",
        );
        if (this.collaborationLearning) {
          try { await this.collaborationLearning.observe(pending.message, task); }
          catch (error) { this.logger.error("collaboration learning observe failed", error); }
        }
        if (this.shadowCollaboration) {
          try { await this.shadowCollaboration.observe(pending.message, context, task); }
          catch (error) { this.logger.error("shadow collaboration observe failed", error); }
        }
        if (task.taskAction === "ignored") {
          this.state.state.mentionProcessedMessageIds.push(pending.message.message_id);
          this.state.state.mentionPending.splice(index, 1);
          await this.state.save();
          continue;
        }
        let userNotified = false;
        let clarification = this.state.state.mentionClarifications.find((item) => (
          item.sourceMessageId === pending.message.message_id || item.taskId === task.taskId
        ));
        if (task.needsClarification && !clarification) {
          const interaction = await this.interactionPolicy(pending.message);
          if (interaction.allowed) {
            const reply = await this.lark.replyAsUser(
              pending.message.message_id,
              `**我是常东旭的 AI 分身。** 为了避免理解偏差，需要确认一个会影响后续处理的问题：\n\n${task.clarificationQuestion}`,
              `clarify:${pending.message.message_id}`,
            );
            clarification = {
              sourceMessageId: pending.message.message_id,
              questionMessageId: reply?.message_id || reply?.messageId || null,
              chatId: pending.message.chat_id,
              senderId: pending.message.sender?.id,
              askedAt: new Date().toISOString(),
              taskId: task.taskId,
              researchSessionId: null,
            };
            this.state.state.mentionClarifications.push(clarification);
            await this.state.save();
          } else {
            await this.safeSend(
              `该重点消息存在需要澄清的信息，但未向对方发送：${interaction.reason}\n\n建议问题：${task.clarificationQuestion}\n来源：${pending.message.chat_name || pending.message.chat_id}`,
              `clarify-blocked:${pending.message.message_id}`,
            );
            userNotified = true;
          }
        }
        const existingResearch = this.state.state.mentionResearchSessions.find((item) => (
          item.sourceMessageId === pending.message.message_id || item.taskId === task.taskId
        )) || this.xiaoweiResearch?.hasActiveRequest(task.taskId);
        const existingConfirmation = this.state.state.mentionResearchConfirmations.find((item) => (
          item.sourceMessageId === pending.message.message_id || item.task?.taskId === task.taskId
        ));
        if (task.researchDecision === "start" && task.researchPrompt && !existingResearch && this.runner) {
          const channel = task.researchChannel || "codex";
          if (channel === "xiaowei" && !existingConfirmation) {
            await this.requestResearchApproval(task, pending.message, clarification);
            userNotified = true;
          } else if (channel !== "xiaowei") {
            try {
              await this.startResearch(task, pending.message, clarification, pending.researchSessionId);
            } catch (error) {
              if (error.sessionId) pending.researchSessionId = error.sessionId;
              throw error;
            }
            this.recordResearchDecision(task, "start");
            userNotified = true;
          }
        } else if (task.researchDecision === "confirm" && task.researchPrompt && !existingConfirmation && !existingResearch) {
          await this.requestResearchApproval(task, pending.message, clarification);
          userNotified = true;
        } else if (task.researchDecision === "skip") {
          this.recordResearchDecision(task, "skip");
        }
        this.state.state.mentionProcessedMessageIds.push(pending.message.message_id);
        this.state.state.mentionPending.splice(index, 1);
        await this.state.save();
        const taskAction = task.taskAction || (task.created === false ? "unchanged" : "created");
        const notificationDecision = task.notificationDecision || "notify";
        const policyEvaluation = notificationDecision === "notify"
          ? await this.evaluateNotificationPolicy(pending.message, task)
          : { effect: {}, matches: [] };
        if (policyEvaluation.effect?.attention === "batch" && !userNotified) {
          await this.queueDigestNotification(pending.message, task, taskAction, policyEvaluation);
          userNotified = true;
        } else if (policyEvaluation.effect?.attention === "silent" && !userNotified) {
          userNotified = true;
        }
        if (notificationDecision === "notify" && !userNotified) {
          const actionText = taskAction === "updated" ? "更新了已有自动化待办" : "创建了自动化待办";
          const details = `已根据飞书重点消息${actionText}：**${task.title}**\n\n${task.approvalRequired ? `待批准：${task.approvalSummary}\n` : ""}${task.materialChangeSummary ? `变化：${task.materialChangeSummary}\n` : ""}通知原因：${task.notificationReason || "需要你关注或处理"}\n纳入原因：${pending.message.intakeReasons?.join("、") || "@常东旭"}\n来源：${pending.message.chat_name || pending.message.chat_id} · ${pending.message.sender?.name || "未知发送人"}\n识别：${task.urgencyLabel}${task.keyItem ? " · 关键事项" : ""} · 滴答优先级 ${task.priority}\n标签：${task.tags?.join("、") || "无"}${task.dueDate ? ` · 截止：${task.dueDate}` : ""}\n与你的关联：${task.relationshipSummary}\n任务 ID：${task.taskId}${task.url ? `\n${task.url}` : ""}`;
          if (task.approvalRequired) {
            const actions = [];
            if (pending.message.message_app_link) actions.push({ text: "打开原消息", url: pending.message.message_app_link });
            if (task.url) actions.push({ text: "打开滴答任务", url: task.url });
            if (actions.length) {
              await this.safeSendInteractive(details, actions, { title: "需要你批准", tone: "yellow" }, `mention:${pending.message.message_id}:${taskAction}`);
            } else {
              await this.safeSend(details, `mention:${pending.message.message_id}:${taskAction}`);
            }
          } else {
            await this.safeSend(details, `mention:${pending.message.message_id}:${taskAction}`);
          }
        }
      } catch (error) {
        this.logger.error("focus message processing failed", error);
        pending.attempts += 1;
        pending.lastError = error.message;
        const delayMinutes = Math.min(60, 2 ** Math.min(pending.attempts, 6));
        pending.nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        await this.state.save();
        await this.recordProcessingFailure(error);
        index += 1;
      }
    }
    await this.recoverProcessingFailureIfIdle();
  }

  async recordProcessingFailure(error, now = new Date()) {
    const failure = this.state.state.mentionProcessingFailure || {
      at: now.toISOString(), count: 0, notifiedAt: null,
    };
    failure.count += 1;
    failure.lastAt = now.toISOString();
    failure.error = userFacingError(error);
    this.state.state.mentionProcessingFailure = failure;
    await this.state.save();
    const threshold = Number(this.config.mentionProcessingFailureNotifyThreshold ?? 5);
    const notifyAfterMs = Number(this.config.mentionProcessingFailureNotifyAfterMs ?? 30 * 60_000);
    const sustained = now.getTime() - new Date(failure.at).getTime() >= notifyAfterMs;
    if (!failure.notifiedAt && failure.count >= threshold && sustained) {
      failure.notifiedAt = now.toISOString();
      await this.state.save();
      await this.safeSend(
        `飞书重点消息处理持续异常，消息均已保留并在后台退避重试。\n\n累计失败：${failure.count} 次\n当前待处理：${this.state.state.mentionPending.length} 条\n首次发生：${formatUserTime(failure.at, this.config.notificationTimeZone)}（北京时间）\n错误类别：${failure.error}\n\n暂不需要你介入；只有授权或连接问题无法自动恢复时我会再向你请求帮助。`,
        `mention-processing-failed:${failure.at}`,
      );
    }
  }

  async recoverProcessingFailureIfIdle() {
    const failure = this.state.state.mentionProcessingFailure;
    if (!failure || this.state.state.mentionPending.some((item) => item.lastError)) return;
    this.state.state.mentionProcessingFailure = null;
    await this.state.save();
    if (failure.notifiedAt) {
      await this.safeSend(
        `飞书重点消息处理已恢复，积压消息已处理完毕。故障始于：${formatUserTime(failure.at, this.config.notificationTimeZone)}（北京时间）`,
        `mention-processing-recovered:${failure.at}`,
      );
    }
  }

  async evaluateNotificationPolicy(message, task) {
    if (!this.policyManager?.evaluatePolicies) return { effect: {}, matches: [] };
    const priority = Number(task.priority || 0);
    const urgency = priority === 5 ? "urgent" : priority >= 3 ? "important" : "normal";
    try {
      return await this.policyManager.evaluatePolicies({
        channel: { chatType: message.chat_type, external: undefined },
        source: { chatId: message.chat_id, senderId: message.sender?.id },
        message: {
          mentionsOwner: (message.intakeReasons || []).includes("@常东旭"),
          hasDeadline: Boolean(task.dueDate),
        },
        relation: { kind: task.actionOwner || "unknown" },
        business: { tags: task.tags || [] },
        attention: { current: task.notificationDecision || "notify" },
        urgency,
      });
    } catch (error) {
      this.logger.error("active policy evaluation failed; preserving original notification", error);
      return { effect: {}, matches: [] };
    }
  }

  async queueDigestNotification(message, task, taskAction, policyEvaluation, now = new Date()) {
    this.state.state.notificationDigestPending ??= [];
    const existing = this.state.state.notificationDigestPending.find((item) => item.taskId === task.taskId);
    const item = {
      messageId: message.message_id,
      taskId: task.taskId,
      title: task.title,
      taskAction,
      materialChange: task.materialChangeSummary || "",
      nextAction: task.nextAction || "",
      source: message.chat_name || message.chat_id,
      sender: message.sender?.name || "未知发送人",
      url: task.url || null,
      queuedAt: now.toISOString(),
      policyIds: (policyEvaluation.matches || []).map((match) => match.id),
    };
    if (existing) Object.assign(existing, item);
    else this.state.state.notificationDigestPending.push(item);
    await this.state.save();
  }

  async flushNotificationDigest(now = new Date()) {
    if (this.digestFlushing) return;
    const pending = this.state.state.notificationDigestPending || [];
    if (!pending.length) return;
    if (this.state.state.notificationDigestFailure?.nextAttemptAt
      && new Date(this.state.state.notificationDigestFailure.nextAttemptAt) > now) return;
    const oldest = new Date(pending[0].queuedAt);
    const maxDelay = Number(this.config.notificationDigestMaxDelayMs || 6 * 60 * 60_000);
    if (now - oldest < maxDelay) return;
    this.digestFlushing = true;
    try {
      const items = pending.slice(0, Number(this.config.notificationDigestMaxItems || 20));
      const lines = items.map((item) => (
        `- **${item.title}**${item.materialChange ? `：${item.materialChange}` : item.nextAction ? `：${item.nextAction}` : ""}\n  ${item.source} · ${item.sender}${item.url ? ` · ${item.url}` : ""}`
      ));
      await this.lark.send(
        `**协作事项汇总**\n\n我合并了 ${items.length} 条不需要立即打断你的更新：\n\n${lines.join("\n")}\n\n紧急、明确 @、待批准、特别关注和调研事项不会进入这里。`,
        `notification-digest:${items[0].queuedAt}:${items.at(-1).messageId}`,
      );
      const ids = new Set(items.map((item) => item.messageId));
      this.state.state.notificationDigestPending = pending.filter((item) => !ids.has(item.messageId));
      this.state.state.notificationDigestLastSentAt = now.toISOString();
      this.state.state.notificationDigestFailure = null;
      await this.state.save();
    } catch (error) {
      const attempts = (this.state.state.notificationDigestFailure?.attempts || 0) + 1;
      const delayMs = Math.min(6 * 60 * 60_000, 10 * 60_000 * (2 ** Math.min(attempts - 1, 5)));
      this.state.state.notificationDigestFailure = {
        at: this.state.state.notificationDigestFailure?.at || now.toISOString(),
        attempts,
        lastError: String(error?.message || error).slice(-1000),
        nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(),
      };
      await this.state.save();
      this.logger.error("notification digest delivery failed; retained for retry", error);
    } finally {
      this.digestFlushing = false;
    }
  }

  async discardLowSignalPending() {
    const processed = new Set(this.state.state.mentionProcessedMessageIds);
    const retained = [];
    let changed = false;
    for (const pending of this.state.state.mentionPending) {
      if (!isLowSignalAcknowledgement(pending.message?.content) && !isSyntheticTestMessage(pending.message?.content)) {
        retained.push(pending);
        continue;
      }
      const messageId = pending.message?.message_id;
      if (messageId && !processed.has(messageId)) {
        this.state.state.mentionProcessedMessageIds.push(messageId);
        processed.add(messageId);
      }
      changed = true;
      this.logger.info?.("discarded low-signal focus message", { messageId });
    }
    if (!changed) return 0;
    this.state.state.mentionPending = retained;
    await this.state.save();
    return 1;
  }

  async syncFlaggedConversations(now = new Date()) {
    if (this.config.monitorFlaggedConversations === false || !this.lark.listFlaggedConversations) return;
    const lastSync = this.state.state.flaggedConversationLastSyncAt
      ? new Date(this.state.state.flaggedConversationLastSyncAt)
      : null;
    if (lastSync && now.getTime() - lastSync.getTime() < this.config.flaggedConversationSyncIntervalMs) return;
    try {
      this.state.state.flaggedConversationChatIds = await this.lark.listFlaggedConversations();
      this.state.state.flaggedConversationLastSyncAt = now.toISOString();
      const failure = this.state.state.flaggedConversationHealthFailure;
      this.state.state.flaggedConversationHealthFailure = null;
      await this.state.save();
      if (failure) {
        await this.safeSend(
          `飞书标记会话同步已恢复。故障始于：${formatUserTime(failure.at, this.config.notificationTimeZone)}（北京时间）`,
          `flag-sync-recovered:${failure.at}`,
        );
      }
    } catch (error) {
      if (!this.state.state.flaggedConversationHealthFailure) {
        this.state.state.flaggedConversationHealthFailure = { at: now.toISOString(), error: error.message };
        await this.state.save();
        await this.safeSend(
          `飞书标记会话同步失败，将保留上次成功的关注清单并自动重试。\n\n${userFacingError(error)}`,
          `flag-sync-failed:${now.toISOString()}`,
        );
      }
      this.logger.error("flagged conversation sync failed", error);
    }
  }

  recordResearchDecision(task, finalDecision) {
    this.state.state.researchDecisionHistory.push({
      at: new Date().toISOString(),
      title: task.title,
      suggestedDecision: task.researchDecision,
      finalDecision,
      reason: task.researchDecisionReason,
    });
    this.state.state.researchDecisionHistory = this.state.state.researchDecisionHistory.slice(-100);
  }

  async startResearch(task, message, clarification = null, existingSessionId = null) {
    if ((task.researchChannel || "codex") === "xiaowei" && this.xiaoweiResearch) {
      const request = await this.xiaoweiResearch.request(task, message);
      await this.safeSend(
        `**已交给智造湖小维进行慢速只读排查**\n\n事项：${task.title}\n请求编号：${request.id}\n\n它会重点核对生产日志、Trace、运行版本和环境证据；后台会持续等待回复，不会因响应较慢中断。`,
        `xiaowei-requested:${request.id}`,
      );
      return request;
    }
    const routedSkills = Array.isArray(task.recommendedSkills) && task.recommendedSkills.length
      ? task.recommendedSkills.join("、")
      : "blacklake-reference-router";
    const prompt = `先从 /Users/edy/BlackLakeWork 执行 bash scripts/check-blacklake-agent-sync.sh，并读取 docs/guides/reference-projects/blacklake-reference-router.md；本事项能力路由建议：${routedSkills}。按路由读取对应实时 SKILL.md 和任务所需真源，不得凭缓存判断。\n\n${task.researchPrompt}\n\n飞书来源：${message.chat_name || message.chat_id}\n发送人：${message.sender?.name || "未知发送人"}\n原消息：${message.content}\n任务 ID：${task.taskId}\n\n这是首轮快速调研，请在 20 分钟内收口；优先给出最强证据、根因分层、待验证假设和下一步，不要为穷举整个工作区而无限扩张范围。`;
    const progress = (text) => this.safeSend(`黑湖问题调研中：${task.title}\n\n${text}`, `mention-research:${message.message_id}:progress`);
    const result = existingSessionId
      ? { sessionId: existingSessionId, final: await this.runner.execute({ sessionId: existingSessionId, prompt }, progress) }
      : await this.runner.create(
        prompt,
        `mention:${message.message_id}`,
        progress,
        { readOnly: true, timeoutMs: 20 * 60_000, title: `自动调研：${task.title}` },
      );
    const research = {
      sourceMessageId: message.message_id,
      sessionId: result.sessionId,
      taskId: task.taskId,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      archivedAt: null,
    };
    this.state.state.mentionResearchSessions.push(research);
    if (clarification) clarification.researchSessionId = result.sessionId;
    await this.state.save();
    await this.safeSend(`**黑湖问题已建立可见的 Codex 调研会话**\n\n${task.title}\n会话：${result.sessionId}\n\n${result.final}`, `mention-research:${message.message_id}:final`);
    return research;
  }

  async processApprovedResearch() {
    for (let index = 0; index < this.state.state.mentionResearchConfirmations.length;) {
      const item = this.state.state.mentionResearchConfirmations[index];
      if (item.status !== "approved" || (item.nextAttemptAt && new Date(item.nextAttemptAt) > new Date())) {
        index += 1;
        continue;
      }
      try {
        const clarification = this.state.state.mentionClarifications.find((entry) => entry.taskId === item.clarificationTaskId);
        await this.startResearch(item.task, item.message, clarification, item.researchSessionId);
        this.recordResearchDecision(item.task, "start");
        this.state.state.mentionResearchConfirmations.splice(index, 1);
        await this.state.save();
      } catch (error) {
        if (error.sessionId) item.researchSessionId = error.sessionId;
        item.attempts += 1;
        item.lastError = error.message;
        const delayMinutes = Math.min(60, 2 ** Math.min(item.attempts, 6));
        item.nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        await this.state.save();
        if (item.attempts === 1 || item.attempts % 5 === 0) {
          await this.safeSend(`已确认的调研会话创建失败，${delayMinutes} 分钟后自动重试。\n\n${error.message}`, `research-approved-failed:${item.sourceMessageId}:${item.attempts}`);
        }
        index += 1;
      }
    }
  }

  async requestResearchApproval(task, message, clarification = null) {
    const recommended = task.researchChannel === "xiaowei" ? "智造湖小维（慢速生产取证）" : "Codex（本地代码与方案）";
    const tip = task.researchChannel === "xiaowei"
      ? "（当前为智造湖小维，需要你确认后才会发送）"
      : "";
    const sent = await this.safeSendInteractive(
      `**发现一个可能值得调研的问题，但我暂不启动。**\n\n事项：${task.title}\n判断：${task.researchDecisionReason}\n推荐通道：${recommended}${tip}\n确认编号：${task.taskId}\n\n智造湖小维适合生产日志、Trace、运行版本和实时环境取证，通常需要 10–30 分钟；Codex 适合本地代码、调用链和方案分析。`,
      [{
        text: "交给小维排查",
        value: { type: "research_decision", sourceMessageId: message.message_id, decision: "approve", channel: "xiaowei" },
      }, {
        text: "使用 Codex 调研",
        value: { type: "research_decision", sourceMessageId: message.message_id, decision: "approve", channel: "codex" },
      }, {
        text: "暂不调研",
        value: { type: "research_decision", sourceMessageId: message.message_id, decision: "decline" },
      }],
      { title: "是否启动调研", tone: "yellow" },
      `mention-research-confirm:${message.message_id}`,
    );
    this.state.state.mentionResearchConfirmations.push({
      sourceMessageId: message.message_id,
      task,
      message,
      clarificationTaskId: clarification?.taskId || null,
      questionMessageId: sent?.message_id || sent?.messageId || null,
      status: "pending",
      askedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: null,
    });
    await this.state.save();
  }

  async processClarificationReplies() {
    for (let index = 0; index < this.state.state.mentionClarifications.length;) {
      const item = this.state.state.mentionClarifications[index];
      const messages = await this.lark.getChatMessagesSince(item.chatId, item.askedAt);
      const answer = messages.find((message) => {
        if (message.sender?.id !== item.senderId) return false;
        return message.reply_to === item.questionMessageId ||
          message.reply_to === item.sourceMessageId ||
          message.parent_id === item.questionMessageId ||
          message.parent_id === item.sourceMessageId ||
          message.root_id === item.sourceMessageId;
      });
      if (!answer) { index += 1; continue; }
      if (item.researchSessionId && this.runner) {
        const final = await this.runner.execute({
          id: `clarification:${answer.message_id}`,
          sessionId: item.researchSessionId,
          sessionTitle: "飞书追问补充",
          prompt: `飞书中被追问的人补充了以下信息，请结合它继续原调研，并更新结论：\n\n${answer.content}`,
        }, (message) => this.safeSend(`追问信息已回灌调研会话，${message}`, `clarification:${answer.message_id}:progress`));
        await this.safeSend(`飞书追问已收到并完成后续调研：\n\n${final}`, `clarification:${answer.message_id}:final`);
      } else {
        await this.safeSend(`飞书追问已收到回复：\n\n${answer.content}\n\n对应任务：${item.taskId}`, `clarification:${answer.message_id}:received`);
      }
      this.state.state.mentionClarifications.splice(index, 1);
      await this.state.save();
    }
  }

  async safeSend(markdown, suffix) {
    try { return await this.lark.send(markdown, suffix); }
    catch (error) { this.logger.error("lark notification failed", error); return null; }
  }

  async safeSendStatus(markdown, suffix) {
    try { await this.lark.send(markdown, suffix); return true; }
    catch (error) { this.logger.error("lark notification failed", error); return false; }
  }

  async safeSendInteractive(markdown, actions, options, suffix) {
    try { return await this.lark.sendInteractive(markdown, actions, options, suffix); }
    catch (error) { this.logger.error("lark interactive notification failed", error); return null; }
  }

  async interactionPolicy(message) {
    if (message.chat_type !== "group") return { allowed: true, reason: "私聊" };
    try {
      const chat = await this.lark.getChatInfo(message.chat_id);
      if (chat.external === true) return { allowed: false, reason: "群内含外部人员，按规则禁止自动追问和回复" };
      if (chat.external !== false) return { allowed: false, reason: "无法确认群是否含外部人员，按保守规则禁止发送" };
      return { allowed: true, reason: "已确认内部群" };
    } catch (error) {
      return { allowed: false, reason: `群属性检查失败，按保守规则禁止发送：${error.message}` };
    }
  }
}

export { isoWithOffset, userFacingError };
