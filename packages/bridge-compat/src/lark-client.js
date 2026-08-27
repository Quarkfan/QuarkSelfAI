import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { parseCliJson, run, splitMessage } from "./util.js";
import { buildActionCard, buildInputCard, buildNotificationCard, buildSelectionCard } from "./lark-card.js";

export function buildPriorityMessageFilter(allowedOpenId) {
  const owner = JSON.stringify(String(allowedOpenId));
  return `select(.sender_type=="user" and ((.chat_type=="p2p" and .sender_id==${owner}) or (.chat_type=="group" and ((.mentions // []) | any(.id==${owner})))))`;
}

export class LarkClient {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.environment = {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    };
  }

  run(args) {
    return run(this.config.larkCli, args, { env: this.environment });
  }

  listen(onEvent) {
    const jq = buildPriorityMessageFilter(this.config.allowedOpenId);
    return this.listenToEvent("im.message.receive_v1", jq, onEvent);
  }

  listenCardActions(onEvent) {
    const jq = `select(.operator_id==\"${this.config.allowedOpenId}\")`;
    return this.listenToEvent("card.action.trigger", jq, onEvent);
  }

  listenMembershipAdded(onEvent) {
    const inviter = JSON.stringify(String(this.config.delegationInviter?.openId || ""));
    const owner = JSON.stringify(String(this.config.allowedOpenId));
    const jq = `select(.event.operator_id.open_id==${inviter} and any(.event.users[]?; .user_id.open_id==${owner}))`;
    return this.listenToEvent("im.chat.member.user.added_v1", jq, onEvent);
  }

  listenReactionCreated(onEvent) {
    return this.listenToEvent(
      "im.message.reaction.created_v1",
      'select(.event.operator_type=="user")',
      onEvent,
    );
  }

  listenReactionDeleted(onEvent) {
    return this.listenToEvent(
      "im.message.reaction.deleted_v1",
      'select(.event.operator_type=="user")',
      onEvent,
    );
  }

  listenToEvent(eventKey, jq, onEvent) {
    const child = spawn(this.config.larkCli, [
      "event", "consume", eventKey, "--as", "bot", "--jq", jq,
    ], { stdio: ["pipe", "pipe", "pipe"], env: this.environment });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let buffer = "";
    child.stdout.on("data", (data) => {
      buffer += data;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try { onEvent(JSON.parse(line)); } catch (error) { this.logger.error("invalid event", error); }
      }
    });
    child.stderr.on("data", (data) => this.logger.error(data.trimEnd()));
    child.on("error", (error) => this.logger.error("lark listener spawn failed", error));
    child.on("exit", (code, signal) => this.logger.error(`lark listener exited code=${code} signal=${signal}`));
    return child;
  }

  async reply(messageId, markdown, suffix = "reply") {
    return this.replyCard(messageId, (chunk) => buildNotificationCard(chunk), markdown, suffix);
  }

  async replyInteractive(messageId, markdown, actions, options = {}, suffix = "interactive-reply") {
    return this.replyCard(messageId, (chunk) => buildActionCard(chunk, actions, options), markdown, suffix);
  }

  async replyInput(messageId, markdown, options = {}, suffix = "input-reply") {
    return this.replyCard(messageId, (chunk) => buildInputCard(chunk, options), markdown, suffix);
  }

  async replySelection(messageId, markdown, choices, options = {}, suffix = "selection-reply") {
    return this.replyCard(messageId, (chunk) => buildSelectionCard(chunk, choices, options), markdown, suffix);
  }

  async replyCard(messageId, buildCard, markdown, suffix) {
    const chunks = splitMessage(markdown, this.config.maxReplyChars);
    let last = null;
    for (let index = 0; index < chunks.length; index += 1) {
      const key = createHash("sha256").update(`${messageId}:${suffix}:${index}`).digest("hex").slice(0, 48);
      const result = await this.run([
        "im", "+messages-reply", "--as", "bot", "--message-id", messageId,
        "--msg-type", "interactive", "--content", JSON.stringify(buildCard(chunks[index])),
        "--idempotency-key", key, "--json",
      ]);
      if (result.code !== 0) throw new Error(`飞书回复失败: ${result.stderr || result.stdout}`);
      last = parseCliJson(result.stdout);
    }
    return last?.data ?? last;
  }

  async send(markdown, suffix = String(Date.now())) {
    return this.sendCard((chunk) => buildNotificationCard(chunk), markdown, suffix);
  }

  async sendInteractive(markdown, actions, options = {}, suffix = String(Date.now())) {
    return this.sendCard((chunk) => buildActionCard(chunk, actions, options), markdown, suffix);
  }

  async sendInput(markdown, options = {}, suffix = String(Date.now())) {
    return this.sendCard((chunk) => buildInputCard(chunk, options), markdown, suffix);
  }

  async sendCard(buildCard, markdown, suffix) {
    const chunks = splitMessage(markdown, this.config.maxReplyChars);
    let last = null;
    for (let index = 0; index < chunks.length; index += 1) {
      const key = createHash("sha256").update(`${suffix}:${index}`).digest("hex").slice(0, 48);
      const result = await this.run([
        "im", "+messages-send", "--as", "bot", "--user-id", this.config.allowedOpenId,
        "--msg-type", "interactive", "--content", JSON.stringify(buildCard(chunks[index])),
        "--idempotency-key", key, "--json",
      ]);
      if (result.code !== 0) throw new Error(`飞书发送失败: ${result.stderr || result.stdout}`);
      last = parseCliJson(result.stdout);
    }
    return last?.data ?? last;
  }

  async updateCard(token, card) {
    const result = await this.run([
      "api", "POST", "/open-apis/interactive/v1/card/update", "--as", "bot",
      "--data", JSON.stringify({ token, card }),
    ]);
    if (result.code !== 0) throw new Error(`飞书卡片更新失败: ${result.stderr || result.stdout}`);
    return parseCliJson(result.stdout);
  }

  async replyAsUser(messageId, markdown, suffix = "assistant-reply") {
    const key = createHash("sha256").update(`${messageId}:${suffix}`).digest("hex").slice(0, 48);
    const result = await this.run([
      "im", "+messages-reply", "--as", "user", "--message-id", messageId,
      "--markdown", markdown, "--idempotency-key", key, "--json",
    ]);
    if (result.code !== 0) throw new Error(`飞书分身追问失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    return envelope.data ?? envelope;
  }

  async sendAsUser(userId, markdown, suffix = String(Date.now())) {
    const key = createHash("sha256").update(suffix).digest("hex").slice(0, 48);
    const result = await this.run([
      "im", "+messages-send", "--as", "user", "--user-id", userId,
      "--markdown", markdown, "--idempotency-key", key, "--json",
    ]);
    if (result.code !== 0) throw new Error(`飞书分身私聊发送失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书分身私聊发送失败: ${result.stdout}`);
    return envelope.data ?? envelope;
  }

  async searchUsers(query) {
    const result = await this.run([
      "contact", "+search-user", "--as", "user", "--query", query,
      "--page-size", "20", "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书联系人搜索失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书联系人搜索失败: ${result.stdout}`);
    return envelope.data?.users ?? [];
  }

  async getUsersByIds(userIds) {
    const result = await this.run([
      "contact", "+search-user", "--as", "user", "--user-ids", userIds.join(","),
      "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书联系人校验失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书联系人校验失败: ${result.stdout}`);
    return envelope.data?.users ?? [];
  }

  async searchMentions(start, end) {
    return this.searchMessages([
      "--query", "", "--is-at-me", "--start", start, "--end", end,
    ], "飞书 @消息搜索");
  }

  async searchSpecialAttentionMessages(start, end) {
    const senderIds = (this.config.specialAttentionUsers || []).map((user) => user.openId).filter(Boolean);
    if (!senderIds.length) return [];
    return this.searchMessages([
      "--query", "", "--sender", senderIds.join(","), "--chat-type", "group",
      "--sender-type", "user", "--start", start, "--end", end,
    ], "飞书特别关注消息搜索");
  }

  async searchDirectMessages(start, end) {
    if (this.config.monitorDirectMessages === false) return [];
    return this.searchMessages([
      "--query", "", "--chat-type", "p2p", "--sender-type", "user",
      "--start", start, "--end", end,
    ], "飞书私聊消息搜索");
  }

  async searchFlaggedConversationMessages(start, end, chatIds) {
    if (this.config.monitorFlaggedConversations === false || !chatIds.length) return [];
    return this.searchConversationMessages(start, end, chatIds, "飞书标记会话消息搜索");
  }

  async searchAttentionConversationMessages(start, end, chatIds) {
    if (!chatIds.length) return [];
    return this.searchConversationMessages(start, end, chatIds, "飞书关注会话消息搜索");
  }

  async searchDelegatedGroupMessages(start, end, chatIds) {
    if (!chatIds.length) return [];
    return this.searchConversationMessages(start, end, chatIds, "任永强交接群消息搜索");
  }

  async searchOwnerMessages(start, end) {
    return this.searchMessages([
      "--query", "", "--sender", this.config.allowedOpenId,
      "--sender-type", "user", "--start", start, "--end", end,
    ], "本人参与消息搜索", { includeReactions: true });
  }

  async searchEngagedConversationMessages(start, end, chatIds) {
    if (!chatIds.length) return [];
    const messages = [];
    for (let index = 0; index < chatIds.length; index += 20) {
      messages.push(...await this.searchMessages([
        "--query", "", "--chat-id", chatIds.slice(index, index + 20).join(","),
        "--sender-type", "user", "--start", start, "--end", end,
      ], "本人参与会话表情补偿搜索", { includeReactions: true, pageLimit: 2 }));
    }
    return messages;
  }

  async searchConversationMessages(start, end, chatIds, label) {
    const messages = [];
    for (let index = 0; index < chatIds.length; index += 20) {
      messages.push(...await this.searchMessages([
        "--query", "", "--chat-id", chatIds.slice(index, index + 20).join(","),
        "--sender-type", "user", "--start", start, "--end", end,
      ], label));
    }
    return messages;
  }

  async listFlaggedConversations() {
    if (this.config.monitorFlaggedConversations === false) return [];
    const result = await this.run([
      "im", "+flag-list", "--as", "user", "--page-all",
      "--page-limit", String(this.config.flagPageLimit || 1000), "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书标记列表读取失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书标记列表读取失败: ${result.stdout}`);
    if (envelope.data?.has_more === true) throw new Error("飞书标记列表分页未完成，无法安全同步关注会话。");
    const active = envelope.data?.flag_items ?? [];
    const messagesById = new Map((envelope.data?.messages ?? []).map((message) => [message.message_id, message]));
    const chatIds = new Set();
    for (const flag of active) {
      const message = flag.message || messagesById.get(flag.item_id);
      if (message?.chat_id) chatIds.add(message.chat_id);
    }
    return [...chatIds].sort();
  }

  async listFeedShortcutConversations() {
    const chatIds = new Set();
    let pageToken = null;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.run([
        "im", "+feed-shortcut-list", "--as", "user", "--no-detail",
        ...(pageToken ? ["--page-token", pageToken] : []), "--format", "json",
      ]);
      if (result.code !== 0) throw new Error(`飞书置顶会话读取失败: ${result.stderr || result.stdout}`);
      const envelope = parseCliJson(result.stdout);
      if (envelope.ok !== true) throw new Error(`飞书置顶会话读取失败: ${result.stdout}`);
      for (const shortcut of envelope.data?.shortcuts ?? []) {
        if (shortcut.type === 1 && shortcut.feed_card_id) chatIds.add(shortcut.feed_card_id);
      }
      if (envelope.data?.has_more !== true) return [...chatIds].sort();
      pageToken = envelope.data?.page_token;
      if (!pageToken) throw new Error("飞书置顶会话返回 has_more=true 但缺少 page_token。");
    }
    throw new Error("飞书置顶会话分页超过安全上限，保留上次同步结果。");
  }

  async listFeedGroupConversations() {
    const result = await this.run([
      "im", "+feed-group-list", "--as", "user", "--page-all", "--page-limit", "1000", "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书会话分组读取失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书会话分组读取失败: ${result.stdout}`);
    if (envelope.data?.has_more === true) throw new Error("飞书会话分组分页未完成，保留上次同步结果。");
    const memberships = [];
    for (const group of envelope.data?.groups ?? []) {
      const itemsResult = await this.run([
        "im", "+feed-group-list-item", "--as", "user", "--feed-group-id", group.group_id,
        "--page-all", "--page-limit", "1000", "--format", "json",
      ]);
      if (itemsResult.code !== 0) throw new Error(`飞书会话分组成员读取失败: ${itemsResult.stderr || itemsResult.stdout}`);
      const itemsEnvelope = parseCliJson(itemsResult.stdout);
      if (itemsEnvelope.ok !== true) throw new Error(`飞书会话分组成员读取失败: ${itemsResult.stdout}`);
      if (itemsEnvelope.data?.has_more === true) throw new Error(`飞书会话分组「${group.name}」分页未完成。`);
      for (const item of itemsEnvelope.data?.items ?? []) {
        if (item.feed_type === "chat" && item.feed_id) {
          memberships.push({ chatId: item.feed_id, groupId: group.group_id, groupName: group.name, groupType: group.type });
        }
      }
    }
    return memberships;
  }

  async listGroupNotificationSettings(groupChats = null) {
    const chats = groupChats || await this.listGroupChats();
    const settings = [];
    for (let index = 0; index < chats.length; index += 10) {
      const result = await this.run([
        "im", "chat.user_setting", "batch_query", "--as", "user",
        "--data", JSON.stringify({ chat_ids: chats.slice(index, index + 10).map((chat) => chat.chat_id) }),
        "--format", "json",
      ]);
      if (result.code !== 0) throw new Error(`飞书群通知设置读取失败: ${result.stderr || result.stdout}`);
      const envelope = parseCliJson(result.stdout);
      if (envelope.ok !== true) throw new Error(`飞书群通知设置读取失败: ${result.stdout}`);
      settings.push(...(envelope.data?.items ?? []));
    }
    return settings;
  }

  async listConversationAttentionSignals() {
    const profiles = new Map();
    const sourceErrors = [];
    const chats = await this.listGroupChats();
    const chatById = new Map(chats.map((chat) => [chat.chat_id, chat]));
    const ensure = (chatId) => {
      const chat = chatById.get(chatId) || {};
      if (!profiles.has(chatId)) profiles.set(chatId, {
        chatId, chatName: chat.name || "", external: chat.external === true,
        sources: [], feedGroups: [], muted: false, muteAtAll: false,
      });
      return profiles.get(chatId);
    };
    try {
      for (const chatId of await this.listFeedShortcutConversations()) ensure(chatId).sources.push("pinned");
    } catch (error) {
      sourceErrors.push({ source: "pinned", error: error.message });
    }
    try {
      for (const membership of await this.listFeedGroupConversations()) {
        const profile = ensure(membership.chatId);
        if (!profile.sources.includes("feed_group")) profile.sources.push("feed_group");
        profile.feedGroups.push({ id: membership.groupId, name: membership.groupName, type: membership.groupType });
      }
    } catch (error) {
      sourceErrors.push({ source: "feed_group", error: error.message });
    }
    try {
      for (const setting of await this.listGroupNotificationSettings(chats)) {
        if (!setting.is_muted && !setting.is_mute_at_all) continue;
        const profile = ensure(setting.chat_id);
        profile.muted = setting.is_muted === true;
        profile.muteAtAll = setting.is_mute_at_all === true;
      }
    } catch (error) {
      sourceErrors.push({ source: "notification_setting", error: error.message });
    }
    return {
      profiles: [...profiles.values()].sort((left, right) => left.chatId.localeCompare(right.chatId)),
      sourceErrors,
      inventory: { groupChats: chats.length },
    };
  }

  async listGroupChats() {
    const result = await this.run([
      "im", "+chat-list", "--as", "user", "--page-all", "--page-limit", "100",
      "--page-size", "100", "--sort", "active_time", "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书群列表读取失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书群列表读取失败: ${result.stdout}`);
    if (envelope.data?.has_more === true || envelope.meta?.pagination?.complete === false) {
      throw new Error("飞书群列表分页未完成，无法安全识别新加入群聊。");
    }
    return envelope.data?.chats ?? [];
  }

  async listAgenda(start, end) {
    const result = await this.run([
      "calendar", "+agenda", "--as", "user", "--start", start, "--end", end, "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书日程读取失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书日程读取失败: ${result.stdout}`);
    if (Array.isArray(envelope.data)) return envelope.data;
    return envelope.data?.events ?? envelope.events ?? [];
  }

  async searchMessages(filters, label, options = {}) {
    const enrichment = options.includeReactions === true ? [] : ["--no-reactions"];
    const result = await this.run([
      "im", "+messages-search", "--as", "user", ...filters, "--page-size", "50",
      "--page-limit", String(options.pageLimit || 5), ...enrichment, "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`${label}失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`${label}失败: ${result.stdout}`);
    return envelope.data?.messages ?? [];
  }

  async getMessagesByIds(messageIds, { includeReactions = false } = {}) {
    if (!messageIds.length) return [];
    const result = await this.run([
      "im", "+messages-mget", "--as", "user", "--message-ids", messageIds.slice(0, 50).join(","),
      ...(includeReactions ? [] : ["--no-reactions"]), "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书目标消息读取失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书目标消息读取失败: ${result.stdout}`);
    return envelope.data?.messages ?? [];
  }

  async getMentionContext(message, minutes) {
    const targetTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(message.create_time || "")
      ? new Date(`${message.create_time.replace(" ", "T")}:00+08:00`)
      : new Date(message.create_time || Date.now());
    const start = new Date(targetTime.getTime() - minutes * 60_000);
    const contextEnd = new Date(targetTime.getTime() + minutes * 60_000);
    const now = new Date();
    const toOffset = (date) => new Date(date.getTime() + 8 * 60 * 60 * 1000)
      .toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
    const fetchRange = async (rangeStart, rangeEnd, order, pageLimit) => {
      const result = await this.run([
        "im", "+chat-messages-list", "--as", "user", "--chat-id", message.chat_id,
        "--start", toOffset(rangeStart), "--end", toOffset(rangeEnd), "--order", order,
        "--page-size", "50", "--page-limit", String(pageLimit), "--no-reactions", "--format", "json",
      ]);
      if (result.code !== 0) throw new Error(`飞书上下文读取失败: ${result.stderr || result.stdout}`);
      const envelope = parseCliJson(result.stdout);
      if (envelope.ok !== true) throw new Error(`飞书上下文读取失败: ${result.stdout}`);
      return envelope.data?.messages ?? [];
    };
    const nearby = await fetchRange(start, contextEnd, "asc", 3);
    if (now <= contextEnd) return nearby;

    // A retry may happen hours or days after the target message. Read the newest
    // tail separately in descending order so a busy group cannot hide the user's
    // later reply behind the first pages of an old backlog.
    const latestDescending = await fetchRange(targetTime, now, "desc", 3);
    const byId = new Map();
    for (const item of nearby) byId.set(item.message_id, item);
    for (const item of latestDescending.reverse()) byId.set(item.message_id, item);
    return [...byId.values()];
  }

  async getChatMessagesSince(chatId, start) {
    const result = await this.run([
      "im", "+chat-messages-list", "--as", "user", "--chat-id", chatId,
      "--start", start, "--end", new Date().toISOString(), "--order", "asc",
      "--page-size", "50", "--page-limit", "3", "--no-reactions", "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书追问回复读取失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书追问回复读取失败: ${result.stdout}`);
    return envelope.data?.messages ?? [];
  }

  async getChatInfo(chatId) {
    const result = await this.run([
      "im", "chats", "get", "--as", "user", "--chat-id", chatId, "--format", "json",
    ]);
    if (result.code !== 0) throw new Error(`飞书群属性读取失败: ${result.stderr || result.stdout}`);
    const envelope = parseCliJson(result.stdout);
    if (envelope.ok !== true) throw new Error(`飞书群属性读取失败: ${result.stdout}`);
    return envelope.data;
  }
}
