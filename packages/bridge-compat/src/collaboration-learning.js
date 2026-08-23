import { createHash } from "node:crypto";
import { classifyAttention } from "./shadow-collaboration.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function scopeKey(kind, id) {
  return `${kind}:${id}`;
}

function sourceCondition(kind, id) {
  return { fact: kind === "chat" ? "source.chatId" : "source.senderId", op: "eq", value: id };
}

export class CollaborationLearningMonitor {
  constructor({ config, state, lark, policyManager, logger = console }) {
    this.config = config;
    this.state = state;
    this.lark = lark;
    this.policyManager = policyManager;
    this.logger = logger;
    this.evaluating = false;
  }

  ensureState() {
    this.state.state.collaborationLearning ??= {
      version: 1,
      observations: [],
      ownerSignals: [],
      candidates: [],
      lastEvaluatedAt: null,
      lastProposalAt: null,
    };
    return this.state.state.collaborationLearning;
  }

  async observe(message, task, now = new Date()) {
    const learning = this.ensureState();
    const tier = classifyAttention(task, now);
    const actualNotification = task.notificationDecision || "silent";
    let difference = "aligned";
    if (actualNotification === "notify" && tier === "silent") difference = "possible_noise";
    else if (actualNotification === "notify" && tier === "today") difference = "could_batch";
    else if (actualNotification === "silent" && tier === "realtime") difference = "possible_miss";
    learning.observations.push({
      at: now.toISOString(),
      messageId: message.message_id,
      chatId: message.chat_id || null,
      senderId: message.sender?.id || null,
      intakeReasons: unique(message.intakeReasons || []).slice(0, 5),
      attentionTier: tier,
      actualNotification,
      difference,
      taskAction: task.taskAction || (task.created ? "created" : task.taskId ? "unchanged" : "ignored"),
      approvalRequired: task.approvalRequired === true,
      researchDecision: task.researchDecision || "skip",
      actionOwner: task.actionOwner || "unknown",
      materialChange: Boolean(task.materialChangeSummary),
    });
    learning.observations = learning.observations.slice(-2000);
    await this.state.save();
  }

  async recordOwnerMessage(event, now = new Date()) {
    const learning = this.ensureState();
    const text = String(event.content || "").trim();
    learning.ownerSignals.push({
      at: now.toISOString(),
      type: "direct_message",
      messageId: event.message_id,
      explicitReply: Boolean(event.reply_to || event.root_id || event.thread_id),
      shortMessage: text.length <= 20,
      continuationCue: /^(继续|就这个|按这个|可以|好的|处理吧|执行吧|改一下|再补充|另外)/u.test(text),
      correctionCue: /(不对|不是|应该|改为|改成|纠正|补充)/u.test(text),
      approvalCue: /(同意|批准|确认|可以执行|执行吧)/u.test(text),
      rejectionCue: /(不同意|不批准|先不|暂不|不要|取消)/u.test(text),
    });
    learning.ownerSignals = learning.ownerSignals.slice(-1000);
    await this.state.save();
  }

  async recordOwnerSignal(signal, now = new Date()) {
    const learning = this.ensureState();
    learning.ownerSignals.push({ at: now.toISOString(), ...signal });
    learning.ownerSignals = learning.ownerSignals.slice(-1000);
    if (signal.type === "policy_decision") {
      const candidate = learning.candidates.find((item) => item.policyId === signal.policyId);
      if (candidate) {
        candidate.status = signal.decision === "approve" ? "approved" : "declined";
        candidate.decidedAt = now.toISOString();
      }
    }
    await this.state.save();
  }

  candidateScopes(observations) {
    const scopes = new Map();
    for (const observation of observations) {
      for (const [kind, id] of [["chat", observation.chatId], ["sender", observation.senderId]]) {
        if (!id) continue;
        const key = scopeKey(kind, id);
        if (!scopes.has(key)) scopes.set(key, { key, kind, id, observations: [] });
        scopes.get(key).observations.push(observation);
      }
    }
    return [...scopes.values()];
  }

  evaluateScope(scope) {
    const items = scope.observations;
    const reducible = items.filter((item) => ["possible_noise", "could_batch"].includes(item.difference)).length;
    const protectedCount = items.filter((item) => (
      item.attentionTier === "realtime"
      || item.difference === "possible_miss"
      || item.approvalRequired
      || ["start", "confirm"].includes(item.researchDecision)
      || item.intakeReasons.includes("@常东旭")
      || item.intakeReasons.some((reason) => reason.startsWith("特别关注"))
    )).length;
    return {
      ...scope,
      sampleCount: items.length,
      reducible,
      protectedCount,
      confidence: items.length ? reducible / items.length : 0,
      lastAt: items.at(-1)?.at || null,
    };
  }

  async poll(now = new Date()) {
    if (this.evaluating || this.config.collaborationLearningEnabled === false) return;
    const learning = this.ensureState();
    const interval = Number(this.config.collaborationLearningIntervalMs || DAY_MS);
    if (learning.lastEvaluatedAt && now - new Date(learning.lastEvaluatedAt) < interval) return;
    this.evaluating = true;
    try {
      learning.lastEvaluatedAt = now.toISOString();
      const minimumSamples = Number(this.config.collaborationLearningMinimumSamples || 20);
      const minimumScopeSamples = Number(this.config.collaborationLearningMinimumScopeSamples || 8);
      if (learning.observations.length < minimumSamples) {
        await this.state.save();
        return;
      }
      const proposedRecently = learning.lastProposalAt
        && now - new Date(learning.lastProposalAt) < Number(this.config.collaborationLearningProposalCooldownMs || 7 * DAY_MS);
      if (proposedRecently) {
        await this.state.save();
        return;
      }
      const candidate = this.candidateScopes(learning.observations)
        .map((scope) => this.evaluateScope(scope))
        .filter((scope) => scope.sampleCount >= minimumScopeSamples && scope.protectedCount === 0 && scope.confidence >= 0.75)
        .filter((scope) => !learning.candidates.some((item) => item.scopeKey === scope.key && ["proposed", "approved", "declined"].includes(item.status)))
        .sort((left, right) => right.reducible - left.reducible || right.confidence - left.confidence)[0];
      if (!candidate) {
        await this.state.save();
        return;
      }
      const label = candidate.kind === "chat" ? "这个飞书会话" : "这位联系人";
      const sourceText = `根据持续协作样本，${label}的普通非紧急消息优先批量汇总；明确紧急、待批准、需要追问或调研的消息仍即时通知。`;
      const document = {
        version: 1,
        name: `${label}普通消息批量汇总`,
        description: `从 ${candidate.sampleCount} 条脱敏协作样本中发现 ${candidate.reducible} 条可合并通知；只限定精确来源，紧急保护由模拟门禁复核。`,
        priority: 200,
        when: sourceCondition(candidate.kind, candidate.id),
        effect: { attention: "batch" },
      };
      const proposal = await this.policyManager.proposePolicy(sourceText, document);
      const record = {
        scopeKey: candidate.key,
        kind: candidate.kind,
        sourceIdHash: createHash("sha256").update(candidate.id).digest("hex").slice(0, 16),
        sampleCount: candidate.sampleCount,
        reducibleCount: candidate.reducible,
        confidence: candidate.confidence,
        policyId: proposal.id,
        revision: proposal.revision,
        simulation: proposal.simulation,
        status: proposal.simulation?.safeToActivate === true ? "proposed" : "observing",
        proposedAt: now.toISOString(),
      };
      learning.candidates.push(record);
      learning.candidates = learning.candidates.slice(-100);
      if (record.status !== "proposed") {
        await this.state.save();
        return;
      }
      await this.lark.sendInteractive(
        `**我从协作中发现了一个稳定模式，但尚未启用。**\n\n建议：${sourceText}\n样本：${candidate.sampleCount} 条，其中 ${candidate.reducible} 条适合合并，置信度 ${Math.round(candidate.confidence * 100)}%。\n本地模拟：命中 ${proposal.simulation.matchedCount} 条，误抑制紧急消息 ${proposal.simulation.urgentSuppressedCount} 条。\n\n批准后只改变通知节奏，不会自动回复、外联或忽略任务。你也可以在输入框补充边界。`,
        [{
          text: "批准启用",
          value: { type: "policy_decision", decision: "approve", policyId: proposal.id, revision: proposal.revision, name: document.name },
        }, {
          text: "暂不启用",
          value: { type: "policy_decision", decision: "decline", policyId: proposal.id, revision: proposal.revision, name: document.name },
        }],
        {
          title: "协作模式建议",
          tone: "yellow",
          includeInput: true,
          label: "补充适用边界（可选）",
          placeholder: "例如：客户阻塞、生产故障仍需立即提醒",
          submitText: "提交补充要求",
        },
        `collaboration-pattern:${proposal.id}:${proposal.revision}`,
      );
      learning.lastProposalAt = now.toISOString();
      await this.state.save();
    } catch (error) {
      this.logger.error("collaboration learning evaluation failed", error);
      await this.state.save();
    } finally {
      this.evaluating = false;
    }
  }
}
