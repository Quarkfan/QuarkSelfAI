import type { AssistantPolicyDocument, AssistantPolicySimulation } from './policy-model.js'

export type AttentionTier = 'silent' | 'today' | 'realtime'
export type NotificationDecision = 'silent' | 'notify'

export interface CollaborationMessage {
  readonly messageId: string
  readonly chatId?: string
  readonly senderId?: string
  readonly intakeReasons?: readonly string[]
  readonly signal?: {
    readonly type: string
    readonly operation?: string
    readonly emojiType?: string
    readonly ownerOperated?: boolean
  }
}

export interface CollaborationTaskDecision {
  readonly priority?: number
  readonly dueDate?: string
  readonly notificationDecision?: NotificationDecision
  readonly needsClarification?: boolean
  readonly actionRequired?: boolean
  readonly actionOwner?: 'changdongxu' | 'shared' | 'other' | 'unknown'
  readonly researchDecision?: 'start' | 'confirm' | 'skip'
  readonly approvalRequired?: boolean
  readonly taskAction?: 'created' | 'updated' | 'unchanged' | 'ignored'
  readonly materialChangeSummary?: string
}

export interface CollaborationLearningConfig {
  readonly enabled?: boolean
  readonly evaluationIntervalMs?: number
  readonly minimumSamples?: number
  readonly minimumScopeSamples?: number
  readonly proposalCooldownMs?: number
  readonly dailyBriefEnabled?: boolean
  readonly autoTuneMinimumSamples?: number
  readonly autoTuneConfidence?: number
}

export interface CollaborationGuidanceProfile {
  readonly key: string
  readonly signalType: string
  readonly emojiType?: string
  readonly ownerOperated?: boolean
  readonly recommendation: 'prefer-silent-ignore'
  readonly sampleCount: number
  readonly confidence: number
  readonly updatedAt: string
}

export interface CollaborationDailyReview {
  readonly reviewedAt: string
  readonly windowStartedAt: string
  readonly sampleCount: number
  readonly taskCreated: number
  readonly taskUpdated: number
  readonly taskIgnored: number
  readonly notifications: number
  readonly possibleNoise: number
  readonly possibleMisses: number
  readonly ownerCorrections: number
  readonly ownerApprovals: number
  readonly decision: 'no-change' | 'auto-tuned' | 'approval-proposed'
  readonly autoAdjustments: readonly string[]
  readonly proposal?: CollaborationPolicyProposal
  readonly briefTitle: string
  readonly briefBody: string
}

export interface CollaborationPolicyProposal {
  readonly id: string
  readonly revision: number
  readonly sourceText: string
  readonly document: AssistantPolicyDocument
  readonly simulation: AssistantPolicySimulation
  readonly sampleCount: number
  readonly reducibleCount: number
  readonly confidence: number
}
