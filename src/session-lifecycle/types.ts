import type { DurableAuthorizationEvidence } from '../domain/authorization.js'

export const SESSION_EFFECTS = {
  inspect: 'codex-session.inspect.v1',
  archiveIfNeeded: 'codex-session.archive-if-needed.v1',
  deleteIfArchived: 'codex-session.delete-if-archived.v1',
} as const

export interface SessionLifecycleConfig {
  readonly enabled?: boolean
  readonly pollIntervalMs?: number
  readonly retryBaseMs?: number
  readonly retryMaxMs?: number
  readonly deleteAfterDays?: number
  readonly failureNotifyThreshold?: number
  readonly failureNotifyCooldownMs?: number
  readonly authorization?: DurableAuthorizationEvidence & {
    readonly minimumArchivedDays: number
  }
}

export interface TrackResearchSessionInput extends Readonly<Record<string, unknown>> {
  readonly sessionId: string
  readonly taskId: string
  readonly eligible?: boolean
  readonly createdAt?: string
  readonly managedBy: 'quarkselfai-auto-research'
}
