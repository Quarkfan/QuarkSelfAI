import { createHash } from "node:crypto";
import { buildNotificationCard } from "./lark-card.js";

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function workdaySlot(now, timeZone = "Asia/Shanghai", scheduledHour = 10) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const localDay = WEEKDAY_INDEX[parts.weekday];
  const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
  return { dayKey, due: localDay >= 1 && localDay <= 5 && Number(parts.hour) >= scheduledHour };
}

function formatReminder(item, index) {
  const urgency = item.urgency === "high" ? "高" : item.urgency === "medium" ? "中" : "低";
  return `${index + 1}. [${urgency}] ${item.title}\n原因：${item.reason}\n建议：${item.recommendedAction}${item.url ? `\n${item.url}` : ""}`;
}

function outreachId(item) {
  return createHash("sha256").update(`${item.taskId}:${item.personOpenId || item.personName}:${item.question}`)
    .digest("hex").slice(0, 16);
}

function compactContact(user) {
  return {
    openId: user.open_id,
    name: user.localized_name || user.name || user.open_id,
    department: user.department || "",
    email: user.enterprise_email || user.email || "",
    external: user.is_cross_tenant === true,
  };
}

export class WorkdayFollowupMonitor {
  constructor({ config, state, lark, taskCreator, logger = console }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.taskCreator = taskCreator;
    this.logger = logger;
    this.running = false;
  }

  async poll(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      this.state.state.followupOutreachRequests ??= [];
      await this.processOutreachSetup(now);
      await this.processOutreachReplies(now);
      const slot = workdaySlot(now, this.config.followupTimeZone, this.config.followupScheduledHour);
      if (!slot.due || this.state.state.followupLastCheckedDay === slot.dayKey) return;
      const result = await this.taskCreator.evaluateWorkdayFollowups(now);
      const updates = result.updates ?? [];
      const reminders = result.reminders ?? [];
      const outreachRequests = result.outreachRequests ?? [];
      if (updates.length) {
        const detail = updates.map((item, index) =>
          `${index + 1}. **${item.title}**\n变更：${item.changes.join("；")}\n原因：${item.reason}${item.url ? `\n${item.url}` : ""}`).join("\n\n");
        await this.lark.send(`我已维护自动化跟进清单中的 ${updates.length} 项任务：\n\n${detail}`,
          `workday-followup-updates:${slot.dayKey}`);
      }
      if (reminders.length) {
        const detail = reminders.map(formatReminder).join("\n\n");
        await this.lark.send(
          `自动化跟进清单今天有 ${reminders.length} 项建议你跟进（共检查 ${result.totalActive} 项）：\n\n${detail}`,
          `workday-followup:${slot.dayKey}`,
        );
      }
      await this.registerOutreachRequests(outreachRequests, now);
      await this.processOutreachSetup(now);
      this.state.state.followupLastCheckedDay = slot.dayKey;
      this.state.state.followupLastCheckedAt = now.toISOString();
      this.state.state.followupHealthFailure = null;
      await this.state.save();
    } catch (error) {
      this.logger.error("workday followup check failed", error);
      const slot = workdaySlot(now, this.config.followupTimeZone, this.config.followupScheduledHour);
      const previous = this.state.state.followupHealthFailure;
      this.state.state.followupHealthFailure = { dayKey: slot.dayKey, at: now.toISOString(), error: error.message };
      await this.state.save();
      if (previous?.dayKey !== slot.dayKey) {
        try {
          await this.lark.send(`自动化跟进清单今天检查失败，后台会继续重试。\n\n${error.message}`,
            `workday-followup-failed:${slot.dayKey}`);
        } catch {}
      }
    } finally {
      this.running = false;
    }
  }

  async registerOutreachRequests(items, now) {
    const existingIds = new Set(this.state.state.followupOutreachRequests.map((item) => item.id));
    for (const item of items) {
      const id = outreachId(item);
      if (existingIds.has(id)) continue;
      this.state.state.followupOutreachRequests.push({
        ...item, id, status: "new", createdAt: now.toISOString(), attempts: 0,
        nextAttemptAt: null, contact: null, candidates: [],
      });
      existingIds.add(id);
    }
    this.state.state.followupOutreachRequests = this.state.state.followupOutreachRequests.slice(-300);
    await this.state.save();
  }

  async processOutreachSetup(now) {
    for (const request of this.state.state.followupOutreachRequests) {
      if (!["new", "resolution_failed"].includes(request.status)) continue;
      if (request.nextAttemptAt && Date.parse(request.nextAttemptAt) > now.getTime()) continue;
      try {
        await this.resolveContact(request);
      } catch (error) {
        request.status = "resolution_failed";
        request.attempts = Number(request.attempts || 0) + 1;
        request.lastError = error.message;
        request.nextAttemptAt = new Date(now.getTime() + Math.min(6 * 3600_000, 2 ** request.attempts * 60_000)).toISOString();
        await this.state.save();
        if (request.attempts === 1 || request.attempts % 5 === 0) {
          try {
            await this.lark.send(
              `自动化跟进事项暂时无法解析联系人，已保留并会重试。\n\n事项：${request.title}\n联系人线索：${request.personName || request.personOpenId || "无"}\n错误：${error.message}`,
              `followup-contact-failed:${request.id}:${request.attempts}`,
            );
          } catch {}
        }
      }
    }
  }

  async resolveContact(request, query = null) {
    const users = request.personOpenId && !query
      ? await this.lark.getUsersByIds([request.personOpenId])
      : await this.lark.searchUsers(query || request.personName);
    const unique = [...new Map(users.filter((user) => user.open_id)
      .map((user) => [user.open_id, compactContact(user)])).values()];
    const exact = unique.filter((user) => user.name === (query || request.personName));
    const candidates = exact.length ? exact : unique;
    if (candidates.length === 1) {
      request.contact = candidates[0];
      request.candidates = [];
      await this.sendApproval(request);
      return;
    }
    if (candidates.length > 1) {
      request.status = "selecting_contact";
      request.candidates = candidates.slice(0, 5);
      const detail = request.candidates.map((user, index) =>
        `${index + 1}. ${user.name}${user.department ? ` · ${user.department}` : ""}${user.external ? " · 外部联系人" : ""}`).join("\n");
      const sent = await this.lark.sendInteractive(
        `事项：**${request.title}**\n\n“${query || request.personName}”匹配到多个联系人，请选择正确的人：\n\n${detail}`,
        request.candidates.map((user) => ({
          text: `${user.name}${user.department ? ` · ${user.department.slice(0, 16)}` : ""}`,
          value: { type: "followup_contact_choice", requestId: request.id, openId: user.openId },
        })),
        { title: "选择跟进联系人", tone: "yellow" },
        `followup-contact-choice:${request.id}:${query || request.personName}`,
      );
      request.selectionMessageId = sent?.message_id || sent?.messageId || null;
      await this.state.save();
      return;
    }
    request.status = "awaiting_contact_input";
    request.candidates = [];
    const sent = await this.lark.sendInput(
      `事项：**${request.title}**\n\n没有找到联系人“${query || request.personName}”。请填写更准确的姓名或企业邮箱，我会重新搜索，不会直接发送消息。`,
      {
        title: "补充跟进联系人", tone: "yellow", label: "姓名或企业邮箱",
        placeholder: "例如：张三 / zhangsan@example.com", submitName: `followup_contact_${request.id}`,
        submitText: "搜索联系人",
      },
      `followup-contact-input:${request.id}:${query || request.personName}`,
    );
    request.contactInputMessageId = sent?.message_id || sent?.messageId || null;
    await this.state.save();
  }

  async sendApproval(request) {
    const contact = request.contact;
    const sent = await this.lark.sendInteractive(
      `**拟代表你向联系人询问跟进情况**\n\n事项：${request.title}\n接收人：${contact.name}${contact.department ? ` · ${contact.department}` : ""}${contact.external ? " · 外部联系人" : ""}\n发送身份：你的飞书账号，正文明确标注“我是常东旭的 AI 分身”\n\n拟发送问题：\n${request.question}\n\n为什么现在询问：${request.reason}\n背景：${request.context}${request.url ? `\n${request.url}` : ""}`,
      [{
        text: "同意并发送",
        value: { type: "followup_outreach_decision", requestId: request.id, decision: "approve" },
        confirm: {
          title: { tag: "plain_text", content: "确认发送" },
          text: { tag: "plain_text", content: `将以你的账号私聊 ${contact.name}，并明确标注 AI 分身身份。` },
        },
      }, {
        text: "暂不联系",
        value: { type: "followup_outreach_decision", requestId: request.id, decision: "decline" },
      }],
      { title: "确认对外跟进", tone: "yellow" },
      `followup-outreach-approval:${request.id}:${contact.openId}`,
    );
    request.status = "pending_approval";
    request.approvalMessageId = sent?.message_id || sent?.messageId || null;
    request.askedAt = new Date().toISOString();
    await this.state.save();
  }

  async handleCardAction(event, action) {
    if (action.type === "followup_contact_choice") {
      const request = this.findRequest(action.requestId, "selecting_contact");
      const contact = request.candidates.find((candidate) => candidate.openId === action.openId);
      if (!contact) throw new Error("所选联系人已不在候选列表，请重新发起确认。");
      request.contact = contact;
      request.candidates = [];
      await this.state.save();
      await this.sendApproval(request);
      await this.updateInteractionCard(event, buildNotificationCard(`已选择联系人：**${contact.name}**。发送确认卡片已生成。`, {
        title: "联系人已选择", tone: "green", status: "已处理",
      }));
      return;
    }
    if (action.type === "followup_outreach_decision") {
      const request = this.findRequest(action.requestId, "pending_approval");
      if (action.decision !== "approve") {
        request.status = "declined";
        request.decidedAt = new Date().toISOString();
        await this.state.save();
        await this.updateInteractionCard(event, buildNotificationCard(
          `已记录暂不联系 **${request.contact.name}**，任务继续留在自动化跟进清单。`,
          { title: "已暂缓外联", tone: "grey", status: "已处理" },
        ));
        return;
      }
      const message = `**我是常东旭的 AI 分身。** 受他授权，我正在协助跟进事项“${request.title}”。\n\n想向你确认：${request.question}\n\n背景：${request.context}\n\n你的回复会由我整理后反馈给常东旭，并同步到对应的跟进任务中。`;
      const sent = await this.lark.sendAsUser(request.contact.openId, message, `followup-outreach:${request.id}`);
      request.status = "waiting_reply";
      request.sentAt = new Date().toISOString();
      request.sentMessageId = sent?.message_id || sent?.messageId || null;
      request.chatId = sent?.chat_id || sent?.chatId || null;
      request.nextReplyCheckAt = request.sentAt;
      request.decidedAt = request.sentAt;
      await this.state.save();
      await this.updateInteractionCard(event, buildNotificationCard(
        `已以你的账号向 **${request.contact.name}** 发送问题，并明确标注 AI 分身身份。收到回复后我会自动写回滴答任务并反馈给你。`,
        { title: "跟进消息已发送", tone: "green", status: "等待回复" },
      ));
      return;
    }
    if (event.action_tag === "button" && event.action_name?.startsWith("followup_contact_") && event.form_value) {
      const id = event.action_name.slice("followup_contact_".length);
      const request = this.findRequest(id, "awaiting_contact_input");
      let values;
      try { values = JSON.parse(event.form_value); } catch { values = {}; }
      const query = String(values.prompt || "").trim();
      if (!query) throw new Error("没有收到有效的联系人姓名或邮箱。");
      await this.resolveContact(request, query);
      await this.updateInteractionCard(event, buildNotificationCard(`已使用联系人线索：**${query}** 完成搜索，后续确认卡片已生成。`, {
        title: "联系人搜索完成", tone: "green", status: "已处理",
      }));
      return;
    }
    throw new Error("无法识别自动化跟进卡片操作。");
  }

  findRequest(id, expectedStatus) {
    const request = this.state.state.followupOutreachRequests.find((item) => item.id === id);
    if (!request || request.status !== expectedStatus) throw new Error("这项跟进请求已处理或状态已变化。");
    return request;
  }

  async updateInteractionCard(event, card) {
    try {
      await this.lark.updateCard(event.token, card);
    } catch (error) {
      this.logger.error("followup interaction card update failed", error);
      try {
        await this.lark.send(
          `飞书跟进操作已经执行，但原卡片状态更新失败。\n\n${error.message}`,
          `followup-card-update-failed:${event.event_id || event.token}`,
        );
      } catch {}
    }
  }

  async processOutreachReplies(now) {
    for (const request of this.state.state.followupOutreachRequests) {
      if (request.status !== "waiting_reply" || !request.chatId) continue;
      if (request.nextReplyCheckAt && Date.parse(request.nextReplyCheckAt) > now.getTime()) continue;
      try {
        const messages = await this.lark.getChatMessagesSince(request.chatId, request.sentAt);
        const answer = messages.find((message) => message.sender?.id === request.contact.openId
          && message.message_id !== request.sentMessageId);
        if (!answer) {
          request.lastReplyCheckAt = now.toISOString();
          request.nextReplyCheckAt = new Date(now.getTime()
            + Number(this.config.followupReplyPollIntervalMs || 1800000)).toISOString();
          await this.state.save();
          continue;
        }
        const update = await this.taskCreator.recordFollowupReply(request, answer, now);
        request.status = "completed";
        request.replyMessageId = answer.message_id;
        request.replyReceivedAt = answer.create_time || now.toISOString();
        request.replyContent = String(answer.content || "").slice(0, 5000);
        request.taskUpdate = update;
        request.completedAt = now.toISOString();
        await this.state.save();
        await this.lark.send(
          `**${request.contact.name} 已回复自动化跟进事项**\n\n事项：${request.title}\n回复：${request.replyContent}\n\n已写回滴答任务：${update.title}\n变更：${update.changes.join("；")}\n结论：${update.summary}${update.url ? `\n${update.url}` : ""}`,
          `followup-outreach-reply:${request.id}:${answer.message_id}`,
        );
      } catch (error) {
        request.replyCheckFailures = Number(request.replyCheckFailures || 0) + 1;
        request.lastError = error.message;
        request.nextReplyCheckAt = new Date(now.getTime()
          + Math.min(6 * 3600_000, 2 ** request.replyCheckFailures * 60_000)).toISOString();
        await this.state.save();
        if (request.replyCheckFailures === 1 || request.replyCheckFailures % 5 === 0) {
          try {
            await this.lark.send(
              `自动化跟进回复检查或任务写回失败，后台会继续重试。\n\n事项：${request.title}\n联系人：${request.contact.name}\n错误：${error.message}`,
              `followup-reply-failed:${request.id}:${request.replyCheckFailures}`,
            );
          } catch {}
        }
      }
    }
  }
}
