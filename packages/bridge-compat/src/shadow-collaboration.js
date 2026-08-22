import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatUserTime, run } from "./util.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_SCORE = { silent: 0, today: 1, realtime: 2 };
const STOP_WORDS = new Set([
  "常东旭", "飞书", "消息", "事项", "项目", "问题", "跟进", "关注", "确认", "处理", "需要",
  "当前", "最新", "相关", "进行", "同步", "情况", "一个", "这个", "那个", "群聊", "私聊",
  "会议", "周会", "发布", "平台", "配置", "需求", "客户", "黑湖", "技术", "团队",
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function truncate(value, max = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function tokens(...values) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  const latin = text.match(/[a-z][a-z0-9._/-]{2,}/g) ?? [];
  const chinese = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return unique([...latin, ...chinese])
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .slice(0, 24);
}

function anchors(...values) {
  const text = values.filter(Boolean).join(" ");
  return unique([
    ...(text.match(/HHZZ3-\d+/gi) ?? []).map((value) => value.toUpperCase()),
    ...(text.match(/archery[^\d]{0,8}(\d{4,})/gi) ?? []).map((value) => value.replace(/\s+/g, "").toLowerCase()),
    ...(text.match(/[a-z0-9-]+-domain/gi) ?? []).map((value) => value.toLowerCase()),
    ...(text.match(/V\d+\.\d+(?:\.\d+)?/gi) ?? []).map((value) => value.toUpperCase()),
  ]).slice(0, 12);
}

function overlap(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / Math.min(a.size, b.size);
}

function shanghaiDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function parseDue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function classifyAttention(task = {}, now = new Date()) {
  const priority = Number(task.priority ?? 0);
  const due = parseDue(task.dueDate);
  const dueSoon = due && due.getTime() <= now.getTime() + DAY_MS;
  if (priority === 5 || (priority >= 3 && dueSoon)) return "realtime";
  if (
    task.notificationDecision === "notify"
    || priority >= 3
    || task.needsClarification
    || ["start", "confirm"].includes(task.researchDecision)
    || (task.actionRequired && ["changdongxu", "shared"].includes(task.actionOwner))
  ) return "today";
  return "silent";
}

export function buildShadowDecision(message, task = {}, now = new Date()) {
  const taskAction = task.taskAction || (task.created ? "created" : task.taskId ? "unchanged" : "ignored");
  const tier = classifyAttention(task, now);
  const actualNotification = task.notificationDecision || "silent";
  const recommendedNotification = tier === "realtime" ? "notify_now" : tier === "today" ? "daily_digest" : "silent";
  let difference = "aligned";
  if (actualNotification === "notify" && tier === "silent") difference = "possible_noise";
  else if (actualNotification === "notify" && tier === "today") difference = "could_batch";
  else if (actualNotification === "silent" && tier === "realtime") difference = "possible_miss";
  return {
    at: now.toISOString(),
    messageId: message.message_id,
    taskId: task.taskId || null,
    taskAction,
    intakeDecision: task.intakeDecision || (taskAction === "ignored" ? "information" : "task"),
    attentionTier: tier,
    actualNotification,
    recommendedNotification,
    difference,
    title: truncate(task.title || message.chat_name || "未命名事项", 100),
    nextAction: truncate(task.nextAction || "", 160),
    actionOwner: task.actionOwner || "unknown",
    actionRequired: task.actionRequired === true,
    deadline: task.dueDate || null,
    materialChange: truncate(task.materialChangeSummary || "", 200),
  };
}

function matterIdentity(message, decision) {
  const values = [decision.title, decision.nextAction, message.chat_name, message.content];
  const identityAnchors = anchors(...values);
  const identityTokens = tokens(...values);
  const seed = identityAnchors.length ? identityAnchors.join("|") : identityTokens.slice(0, 8).join("|") || message.chat_id;
  return {
    anchors: identityAnchors,
    tokens: identityTokens,
    fallbackKey: `matter:${createHash("sha256").update(seed || message.message_id).digest("hex").slice(0, 16)}`,
  };
}

function findMatter(matters, message, decision) {
  const identity = matterIdentity(message, decision);
  if (decision.taskId) {
    const taskMatch = matters.find((matter) => matter.taskIds?.includes(decision.taskId));
    if (taskMatch) return { matter: taskMatch, identity };
  }
  const anchorMatch = identity.anchors.length
    ? matters.find((matter) => matter.anchors?.some((value) => identity.anchors.includes(value)))
    : null;
  if (anchorMatch) return { matter: anchorMatch, identity };
  const tokenMatch = matters
    .map((matter) => ({ matter, score: overlap(matter.tokens, identity.tokens) }))
    .sort((left, right) => right.score - left.score)[0];
  if (tokenMatch?.score >= 0.6) return { matter: tokenMatch.matter, identity };
  return { matter: null, identity };
}

function calendarMatches(matter, event) {
  const eventAnchors = anchors(event.summary);
  if (eventAnchors.some((value) => matter.anchors?.includes(value))) return true;
  const eventTokens = tokens(event.summary);
  return overlap(matter.tokens, eventTokens) >= 0.5;
}

export function detectTaskFeedback(previous, current, projects) {
  const changes = [];
  if (!previous || !current) return changes;
  if (previous.status !== 2 && current.status === 2) changes.push("completed");
  if (previous.projectId !== current.projectId) {
    if (current.projectId === projects.followupProjectId) changes.push("moved_to_followup");
    else if (current.projectId === projects.didaProjectId) changes.push("moved_to_todo");
    else changes.push("moved_elsewhere");
  }
  if (previous.title !== current.title) changes.push("title_changed");
  if ((previous.dueDate || null) !== (current.dueDate || null)) changes.push("deadline_changed");
  if (previous.priority !== current.priority) changes.push("priority_changed");
  return changes;
}

export class ShadowCollaborationMonitor {
  constructor({ config, state, lark, logger = console }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.logger = logger;
    this.polling = false;
  }

  ensureState(now = new Date()) {
    const root = this.state.state;
    root.shadowMode ??= {
      enabled: this.config.shadowCollaborationEnabled !== false,
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + Number(this.config.shadowCollaborationDays || 7) * DAY_MS).toISOString(),
    };
    root.shadowMatters ??= [];
    root.shadowDecisions ??= [];
    root.shadowCalendar ??= { events: [], lastSyncedAt: null, lastError: null };
    root.shadowTaskSnapshots ??= {};
    root.shadowFeedback ??= [];
    root.shadowReport ??= { generatedAt: null, path: null, sentAt: null, lastError: null };
    return root.shadowMode;
  }

  async observe(message, contextMessages, task) {
    const mode = this.ensureState();
    if (!mode.enabled || new Date() >= new Date(mode.endsAt)) return null;
    const decision = buildShadowDecision(message, task);
    const matters = this.state.state.shadowMatters;
    const { matter: existing, identity } = findMatter(matters, message, decision);
    const matter = existing || {
      key: identity.fallbackKey,
      createdAt: decision.at,
      sources: [], taskIds: [], chatIds: [], senderIds: [], calendarEventIds: [],
    };
    if (!existing) matters.push(matter);
    matter.updatedAt = decision.at;
    matter.title = decision.title;
    matter.status = decision.taskAction === "ignored" ? (matter.status || "observing") : "open";
    matter.attentionTier = TIER_SCORE[decision.attentionTier] > TIER_SCORE[matter.attentionTier || "silent"]
      ? decision.attentionTier : (matter.attentionTier || decision.attentionTier);
    matter.nextAction = decision.nextAction || matter.nextAction || "";
    matter.actionOwner = decision.actionOwner;
    matter.actionRequired = decision.actionRequired;
    matter.deadline = decision.deadline || matter.deadline || null;
    matter.lastMaterialChange = decision.materialChange || matter.lastMaterialChange || "";
    matter.anchors = unique([...(matter.anchors || []), ...identity.anchors]).slice(0, 20);
    matter.tokens = unique([...(matter.tokens || []), ...identity.tokens]).slice(0, 40);
    matter.taskIds = unique([...matter.taskIds, decision.taskId]);
    matter.chatIds = unique([...matter.chatIds, message.chat_id]);
    matter.senderIds = unique([...matter.senderIds, message.sender?.id]);
    matter.sources.push({
      messageId: message.message_id,
      at: message.create_time || decision.at,
      chatId: message.chat_id,
      chatName: truncate(message.chat_name || "", 80),
      senderId: message.sender?.id || null,
      senderName: truncate(message.sender?.name || "", 60),
      intakeReasons: (message.intakeReasons || []).slice(0, 5),
      link: message.message_app_link || null,
      contextCount: Array.isArray(contextMessages) ? contextMessages.length : 0,
    });
    matter.sources = matter.sources.slice(-20);
    decision.matterKey = matter.key;
    this.state.state.shadowDecisions.push(decision);
    this.state.state.shadowDecisions = this.state.state.shadowDecisions.slice(-2000);
    this.correlateCalendarForMatter(matter);
    await this.state.save();
    return decision;
  }

  correlateCalendarForMatter(matter, now = new Date()) {
    const matches = (this.state.state.shadowCalendar?.events || []).filter((event) => calendarMatches(matter, event));
    matter.calendarEventIds = matches.map((event) => event.eventId).slice(0, 20);
    const future = matches.filter((event) => new Date(event.start).getTime() >= now.getTime())
      .sort((left, right) => new Date(left.start) - new Date(right.start))[0];
    matter.nextCalendarEvent = future || null;
  }

  async poll(now = new Date()) {
    if (this.polling) return;
    const mode = this.ensureState(now);
    if (!mode.enabled) return;
    this.polling = true;
    try {
      if (now < new Date(mode.endsAt)) {
        await this.refreshCalendar(now);
        await this.refreshTaskFeedback(now);
      } else {
        await this.finishShadowRun(now);
      }
      await this.state.save();
    } catch (error) {
      this.logger.error("shadow collaboration poll failed", error);
    } finally {
      this.polling = false;
    }
  }

  async refreshCalendar(now) {
    const calendar = this.state.state.shadowCalendar;
    const interval = Number(this.config.shadowCalendarPollIntervalMs || 30 * 60_000);
    if (calendar.lastSyncedAt && now - new Date(calendar.lastSyncedAt) < interval) return;
    try {
      const start = shanghaiDate(now);
      const end = shanghaiDate(new Date(now.getTime() + Number(this.config.shadowCalendarLookaheadDays || 8) * DAY_MS));
      const events = await this.lark.listAgenda(start, end);
      calendar.events = events.slice(0, 200).map((event) => ({
        eventId: event.event_id || event.eventId,
        summary: truncate(event.summary || "", 120),
        start: event.start_time?.datetime || event.start?.dateTime || event.start || null,
        end: event.end_time?.datetime || event.end?.dateTime || event.end || null,
        status: event.status || null,
        rsvp: event.self_rsvp_status || event.selfRsvpStatus || null,
      })).filter((event) => event.eventId && event.start);
      calendar.lastSyncedAt = now.toISOString();
      calendar.lastError = null;
      for (const matter of this.state.state.shadowMatters) this.correlateCalendarForMatter(matter, now);
    } catch (error) {
      calendar.lastError = { at: now.toISOString(), message: truncate(error.message, 500) };
      this.logger.error("shadow calendar refresh failed", error);
    }
  }

  async refreshTaskFeedback(now) {
    const mode = this.state.state.shadowMode;
    const interval = Number(this.config.shadowTaskFeedbackPollIntervalMs || 6 * 60 * 60_000);
    if (mode.taskFeedbackLastAt && now - new Date(mode.taskFeedbackLastAt) < interval) return;
    try {
      const result = await run(this.config.didaCli || "dida", [
        "task", "filter", "--projects", `${this.config.didaProjectId},${this.config.followupProjectId}`,
        "--status", "0,2", "--json",
      ], { timeoutMs: this.config.didaCliTimeoutMs || 30000 });
      if (result.code !== 0 || result.timedOut) throw new Error((result.stderr || result.stdout).trim().slice(-1000));
      const tasks = JSON.parse(result.stdout);
      const trackedIds = new Set(this.state.state.shadowMatters.flatMap((matter) => matter.taskIds || []));
      const currentById = new Map(tasks.filter((task) => trackedIds.has(task.id)).map((task) => [task.id, task]));
      for (const taskId of trackedIds) {
        const previous = this.state.state.shadowTaskSnapshots[taskId];
        const current = currentById.get(taskId);
        if (!current) {
          if (previous) previous.missingCount = (previous.missingCount || 0) + 1;
          if (previous?.missingCount === 2) this.recordFeedback(taskId, "missing", now, {});
          continue;
        }
        for (const type of detectTaskFeedback(previous, current, this.config)) {
          this.recordFeedback(taskId, type, now, { from: previous?.projectId, to: current.projectId });
        }
        this.state.state.shadowTaskSnapshots[taskId] = {
          projectId: current.projectId,
          status: current.status,
          title: current.title,
          dueDate: current.dueDate || null,
          priority: current.priority,
          modifiedTime: current.modifiedTime || null,
          missingCount: 0,
        };
        const matter = this.state.state.shadowMatters.find((item) => item.taskIds?.includes(taskId));
        if (matter) {
          if (current.status === 2) matter.status = "completed";
          else if (current.projectId === this.config.followupProjectId) matter.status = "followup";
          else matter.status = "open";
        }
      }
      mode.taskFeedbackLastAt = now.toISOString();
      mode.taskFeedbackLastError = null;
    } catch (error) {
      mode.taskFeedbackLastError = { at: now.toISOString(), message: truncate(error.message, 500) };
      this.logger.error("shadow task feedback refresh failed", error);
    }
  }

  recordFeedback(taskId, type, now, detail) {
    const duplicate = this.state.state.shadowFeedback.some((item) => item.taskId === taskId && item.type === type);
    if (duplicate && type !== "title_changed" && type !== "deadline_changed" && type !== "priority_changed") return;
    const matter = this.state.state.shadowMatters.find((item) => item.taskIds?.includes(taskId));
    this.state.state.shadowFeedback.push({ at: now.toISOString(), taskId, matterKey: matter?.key || null, type, detail });
    this.state.state.shadowFeedback = this.state.state.shadowFeedback.slice(-1000);
  }

  buildReport(now) {
    const decisions = this.state.state.shadowDecisions;
    const matters = this.state.state.shadowMatters;
    const feedback = this.state.state.shadowFeedback;
    const count = (field, value) => decisions.filter((item) => item[field] === value).length;
    const topMatters = [...matters].sort((left, right) => (right.sources?.length || 0) - (left.sources?.length || 0)).slice(0, 10);
    const metrics = {
      messages: decisions.length,
      matters: matters.length,
      mergedMessages: Math.max(0, decisions.length - matters.length),
      realtime: count("attentionTier", "realtime"),
      today: count("attentionTier", "today"),
      silent: count("attentionTier", "silent"),
      possibleNoise: count("difference", "possible_noise"),
      couldBatch: count("difference", "could_batch"),
      possibleMiss: count("difference", "possible_miss"),
      calendarLinked: matters.filter((matter) => matter.calendarEventIds?.length).length,
      completed: feedback.filter((item) => item.type === "completed").length,
      movedToFollowup: feedback.filter((item) => item.type === "moved_to_followup").length,
      missing: feedback.filter((item) => item.type === "missing").length,
    };
    const markdown = [
      "# 飞书协作影子模式评估",
      "",
      `周期：${formatUserTime(this.state.state.shadowMode.startedAt, this.config.notificationTimeZone)} — ${formatUserTime(now, this.config.notificationTimeZone)}（北京时间）`,
      "",
      `- 分析重点消息：${metrics.messages} 条，归并为 ${metrics.matters} 个事项，减少重复视图 ${metrics.mergedMessages} 条。`,
      `- 注意力建议：实时 ${metrics.realtime}，当日汇总 ${metrics.today}，静默吸收 ${metrics.silent}。`,
      `- 与现有通知差异：可能噪声 ${metrics.possibleNoise}，可延迟汇总 ${metrics.couldBatch}，可能漏提醒 ${metrics.possibleMiss}。`,
      `- 日历关联事项 ${metrics.calendarLinked} 个；任务反馈：完成 ${metrics.completed}，移入跟进 ${metrics.movedToFollowup}，连续缺失 ${metrics.missing}。`,
      "",
      "## 消息量最高的事项",
      ...topMatters.map((matter) => `- ${matter.title}：${matter.sources?.length || 0} 条消息，${matter.attentionTier}，状态 ${matter.status}`),
      "",
      "影子模式未改变正式待办、通知、外联或调研决策。",
    ].join("\n");
    return { metrics, markdown };
  }

  async finishShadowRun(now) {
    const reportState = this.state.state.shadowReport;
    if (!reportState.generatedAt) {
      const report = this.buildReport(now);
      const directory = path.join(this.config.varDir, "shadow-reports");
      await mkdir(directory, { recursive: true });
      const reportPath = path.join(directory, `${shanghaiDate(now)}.md`);
      await writeFile(reportPath, `${report.markdown}\n`, { mode: 0o600 });
      reportState.generatedAt = now.toISOString();
      reportState.path = reportPath;
      reportState.metrics = report.metrics;
      reportState.markdown = report.markdown;
    }
    if (this.config.shadowNotifyOnComplete === false || reportState.sentAt) return;
    try {
      const m = reportState.metrics;
      await this.lark.send(
        `**一周飞书协作影子评估已完成**\n\n分析 ${m.messages} 条消息，归并为 ${m.matters} 个事项。\n注意力建议：实时 ${m.realtime} · 当日汇总 ${m.today} · 静默 ${m.silent}。\n可能噪声 ${m.possibleNoise} · 可合并通知 ${m.couldBatch} · 可能漏提醒 ${m.possibleMiss}。\n\n完整报告：${reportState.path}\n\n本周没有改变正式待办、通知、调研或外联行为。`,
        `shadow-collaboration-report:${this.state.state.shadowMode.startedAt}`,
      );
      reportState.sentAt = now.toISOString();
      reportState.lastError = null;
    } catch (error) {
      reportState.lastError = { at: now.toISOString(), message: truncate(error.message, 500) };
      this.logger.error("shadow report delivery failed", error);
    }
  }
}
