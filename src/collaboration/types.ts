import type { PolicyDocument, PolicySimulation } from '../policy/types.js'

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
  readonly timerIntervalMs?: number
}

export interface CollaborationPolicyProposal {
  readonly id: string
  readonly revision: number
  readonly sourceText: string
  readonly document: PolicyDocument
  readonly simulation: PolicySimulation
  readonly sampleCount: number
  readonly reducibleCount: number
  readonly confidence: number
}
