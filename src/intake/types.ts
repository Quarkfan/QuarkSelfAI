import type { NormalizedChannelEvent } from '../domain/contracts.js'

export const INTAKE_EFFECTS = {
  evaluateFocus: 'assistant.intake.evaluate-focus.v1',
  applyInteraction: 'assistant.intake.apply-interaction.v1',
  discoverSignals: 'feishu.discover-focus-signals.v1',
} as const

export type IntakeRoute = 'owner-command' | 'focus' | 'interaction'
export type IntakeOutcome = 'ignored' | 'task' | 'notify'

export interface IntakeInput {
  readonly route: IntakeRoute
  readonly event: NormalizedChannelEvent
  readonly workspace: string
}

export interface IntakeDecision {
  readonly outcome: IntakeOutcome
  readonly summary: string
  readonly materialChange: boolean
  readonly notifyOwner: boolean
  readonly approvalRequired: boolean
  readonly priority?: 0 | 1 | 3 | 5
  readonly title?: string
  readonly tags?: readonly string[]
  readonly dueDate?: string
  readonly existingTaskId?: string
  readonly researchDecision?: 'start' | 'confirm' | 'skip'
}

export interface IntakePluginConfig {
  readonly enabled?: boolean
  readonly ownerOpenId: string
  readonly workspace: string
  readonly focusSenderIds?: readonly string[]
  readonly focusConversationIds?: readonly string[]
  readonly delegationInviterId?: string
  readonly discoveryIntervalMs?: number
}

export interface IntakeContext {
  readonly messages: readonly Readonly<Record<string, unknown>>[]
  readonly externalGroup: boolean | 'unknown'
  readonly relationship?: string
}

export function validateIntakeDecision(value: unknown): IntakeDecision {
  if (!isRecord(value)) throw new Error('intake decision must be an object')
  const outcome = value.outcome
  if (outcome !== 'ignored' && outcome !== 'task' && outcome !== 'notify') throw new Error('invalid intake outcome')
  if (typeof value.summary !== 'string' || !value.summary.trim()) throw new Error('intake decision summary is required')
  if (typeof value.materialChange !== 'boolean' || typeof value.notifyOwner !== 'boolean' || typeof value.approvalRequired !== 'boolean') {
    throw new Error('intake decision flags are required')
  }
  if (outcome === 'ignored' && (value.notifyOwner || value.approvalRequired)) throw new Error('ignored intake cannot notify or request approval')
  if (!value.materialChange && value.notifyOwner) throw new Error('unchanged intake must remain silent')
  if (value.approvalRequired && !value.notifyOwner) throw new Error('approval-required intake must notify the owner')
  if (outcome === 'task') {
    if (typeof value.title !== 'string' || !value.title.trim()) throw new Error('task intake title is required')
    if (![1, 3, 5].includes(Number(value.priority))) throw new Error('actionable task priority must be 1, 3, or 5')
    if (!Array.isArray(value.tags) || value.tags.some(tag => typeof tag !== 'string' || !tag.trim())) throw new Error('task intake tags must be strings')
  }
  if (value.dueDate !== undefined && Number.isNaN(new Date(String(value.dueDate)).getTime())) throw new Error('invalid intake dueDate')
  if (value.researchDecision !== undefined && !['start', 'confirm', 'skip'].includes(String(value.researchDecision))) throw new Error('invalid research decision')
  return value as unknown as IntakeDecision
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
