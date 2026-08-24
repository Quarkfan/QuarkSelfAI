export const CONVERSATION_EFFECTS = {
  dispatch: 'assistant.conversation.dispatch.v1',
} as const

export interface ConversationDispatchResult extends Readonly<Record<string, unknown>> {
  readonly sessionId: string
  readonly summary: string
  readonly created: boolean
}

export interface ConversationEffectConfig {
  readonly enabled?: boolean
  readonly model?: string
  readonly provider?: string
  readonly titlePrefix?: string
}
