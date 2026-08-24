import type { TaskProjectionTarget } from '../task-system/projection-effects.js'

export interface XiaoweiResearchConfig {
  readonly enabled?: boolean
  readonly agentName?: string
  readonly agentOpenId: string
  readonly agentChatId: string
  readonly retryBaseMs?: number
  readonly retryMaxMs?: number
  readonly failureNotifyThreshold?: number
  readonly taskProjection?: TaskProjectionTarget
}

export interface XiaoweiResearchInput extends Readonly<Record<string, unknown>> {
  readonly requestId: string
  readonly approvedAt: string
  readonly taskId?: string
  readonly title: string
  readonly prompt: string
  readonly sourceChat?: string
  readonly sourceSender?: string
  readonly sentMessageId?: string
  readonly sentAt?: string
}

export interface XiaoweiReplyInput {
  readonly messageId: string
  readonly content: string
  readonly receivedAt: string
  readonly url?: string
}
