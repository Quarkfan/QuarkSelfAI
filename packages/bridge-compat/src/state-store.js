import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = {
  controllerSessionId: null,
  currentSessionId: null,
  lastCandidates: [],
  pendingPrompt: null,
  queue: [],
  processedMessageIds: [],
  ownerControlChatIds: [],
  processedCardEventIds: [],
  ownerConversation: [],
  mentionLastPollAt: null,
  mentionPending: [],
  mentionProcessedMessageIds: [],
  mentionClarifications: [],
  mentionResearchSessions: [],
  mentionResearchConfirmations: [],
  researchDecisionHistory: [],
  xiaoweiResearchRequests: [],
  xiaoweiProcessedMessageIds: [],
  xiaoweiLastPollAt: null,
  xiaoweiHealthFailure: null,
  mentionHealthFailure: null,
  mentionProcessingFailure: null,
  mentionRateLimitFailure: null,
  mentionNextPollAt: null,
  flaggedConversationChatIds: [],
  flaggedConversationLastSyncAt: null,
  flaggedConversationHealthFailure: null,
  conversationAttentionProfiles: [],
  conversationAttentionStrategyVersion: null,
  conversationAttentionLastSyncAt: null,
  conversationAttentionSourceErrors: [],
  conversationAttentionInventory: null,
  conversationAttentionHealthFailure: null,
  delegatedGroupChatIds: [],
  groupMembershipKnownChatIds: [],
  groupMembershipLastSyncAt: null,
  groupMembershipHealthFailure: null,
  ownerEngagedConversations: [],
  ownerEngagementProcessedMessageIds: [],
  ownerEngagementLastPollAt: null,
  ownerEngagementHealthFailure: null,
  reactionPendingEvents: [],
  reactionProcessedEventIds: [],
  reactionStates: {},
  cardActionHealthFailure: null,
  overdueNotified: {},
  overdueHealthFailure: null,
  didaCompletedCleanupLastDay: null,
  didaCompletedCleanupLastAt: null,
  didaCompletedCleanupHealthFailure: null,
  followupLastCheckedDay: null,
  followupLastCheckedAt: null,
  followupHealthFailure: null,
  followupOutreachRequests: [],
  claudeFallbackSessions: [],
  shadowMode: null,
  shadowMatters: [],
  shadowDecisions: [],
  shadowCalendar: null,
  shadowTaskSnapshots: {},
  shadowFeedback: [],
  shadowReport: null,
  collaborationLearning: null,
  notificationDigestPending: [],
  notificationDigestLastSentAt: null,
  notificationDigestFailure: null,
};

function firstCompleteJsonObject(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (!started) {
      if (/\s/.test(character)) continue;
      if (character !== "{") throw new Error("状态文件不是 JSON 对象");
      started = true;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return text.slice(0, index + 1);
  }
  throw new Error("状态文件没有完整的 JSON 对象");
}

export class StateStore {
  constructor(varDir) {
    this.varDir = varDir;
    this.path = path.join(varDir, "state.json");
    this.state = structuredClone(EMPTY_STATE);
    this.saveQueue = Promise.resolve();
  }

  async load() {
    await mkdir(this.varDir, { recursive: true });
    let needsMigrationSave = false;
    try {
      const text = await readFile(this.path, "utf8");
      try {
        this.state = { ...structuredClone(EMPTY_STATE), ...JSON.parse(text) };
      } catch (error) {
        const recovered = JSON.parse(firstCompleteJsonObject(text));
        this.state = { ...structuredClone(EMPTY_STATE), ...recovered };
        await this.save();
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // The bridge used currentSessionId as both router state and execution target
    // before a stable controller session was introduced. Preserve that visible
    // Codex task as the controller during the one-time migration.
    this.state.controllerSessionId ||= this.state.currentSessionId || null;
    if (Array.isArray(this.state.intentQueue)) {
      for (const item of this.state.intentQueue) {
        if (!this.state.controllerSessionId || this.state.queue.some((job) => job.id === item.message_id)) continue;
        this.state.queue.push({
          id: item.message_id,
          sessionId: this.state.controllerSessionId,
          sessionTitle: "飞书总控",
          prompt: item.content,
          receivedAt: item.receivedAt || new Date().toISOString(),
          executor: "codex",
          requestedExecutor: "codex",
          controller: true,
          attempts: item.attempts || 0,
          nextAttemptAt: item.nextAttemptAt || null,
        });
        if (!this.state.processedMessageIds.includes(item.message_id)) this.state.processedMessageIds.push(item.message_id);
      }
      delete this.state.intentQueue;
      needsMigrationSave = true;
    }
    for (const session of this.state.mentionResearchSessions || []) {
      if (/cannot confirm session deletion without an interactive terminal/i.test(session.deleteLastError || "")) {
        session.deleteNextRetryAt = null;
        needsMigrationSave = true;
      }
    }
    if (needsMigrationSave) await this.save();
    return this.state;
  }

  async save() {
    const operation = async () => {
      this.state.processedMessageIds = this.state.processedMessageIds.slice(-500);
      this.state.ownerControlChatIds = [...new Set(this.state.ownerControlChatIds || [])].slice(-20);
      this.state.processedCardEventIds = this.state.processedCardEventIds.slice(-500);
      this.state.ownerConversation = (this.state.ownerConversation || []).slice(-20);
      this.state.mentionProcessedMessageIds = this.state.mentionProcessedMessageIds.slice(-2000);
      this.state.delegatedGroupChatIds = [...new Set(this.state.delegatedGroupChatIds || [])].slice(-500);
      this.state.groupMembershipKnownChatIds = [...new Set(this.state.groupMembershipKnownChatIds || [])].slice(-2000);
      this.state.ownerEngagedConversations = (this.state.ownerEngagedConversations || []).slice(-500);
      this.state.ownerEngagementProcessedMessageIds = (this.state.ownerEngagementProcessedMessageIds || []).slice(-2000);
      this.state.reactionPendingEvents = (this.state.reactionPendingEvents || []).slice(-500);
      this.state.reactionProcessedEventIds = (this.state.reactionProcessedEventIds || []).slice(-2000);
      const reactionEntries = Object.entries(this.state.reactionStates || {})
        .sort((left, right) => String(right[1]?.lastAt || "").localeCompare(String(left[1]?.lastAt || "")))
        .slice(0, 2000);
      this.state.reactionStates = Object.fromEntries(reactionEntries);
      this.state.researchDecisionHistory = this.state.researchDecisionHistory.slice(-100);
      this.state.xiaoweiResearchRequests = this.state.xiaoweiResearchRequests.slice(-300);
      this.state.xiaoweiProcessedMessageIds = this.state.xiaoweiProcessedMessageIds.slice(-2000);
      this.state.shadowFeedback = (this.state.shadowFeedback || []).slice(-1000);
      if (this.state.collaborationLearning) {
        this.state.collaborationLearning.observations = (this.state.collaborationLearning.observations || []).slice(-2000);
        this.state.collaborationLearning.ownerSignals = (this.state.collaborationLearning.ownerSignals || []).slice(-1000);
        this.state.collaborationLearning.candidates = (this.state.collaborationLearning.candidates || []).slice(-100);
        this.state.collaborationLearning.guidanceProfiles = (this.state.collaborationLearning.guidanceProfiles || []).slice(-100);
        this.state.collaborationLearning.reviews = (this.state.collaborationLearning.reviews || []).slice(-90);
      }
      this.state.notificationDigestPending = (this.state.notificationDigestPending || []).slice(-500);
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
    };
    const result = this.saveQueue.then(operation, operation);
    this.saveQueue = result.catch(() => {});
    return result;
  }

  hasProcessed(messageId) {
    return this.state.processedMessageIds.includes(messageId);
  }

  async markProcessed(messageId) {
    this.state.processedMessageIds.push(messageId);
    await this.save();
  }
}
