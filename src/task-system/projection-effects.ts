/** Assistant-owned, semantically enriched projections into a task store. */
export const TASK_PROJECTION_EFFECTS = {
  upsertIntake: 'assistant.task-projection.upsert-intake.v1',
  recordResearchResult: 'assistant.task-projection.record-research-result.v1',
  recordFollowupReply: 'assistant.task-projection.record-followup-reply.v1',
} as const

import type { DurableAuthorizationEvidence } from '../domain/authorization.js'

/** Standing owner authorization captured into every durable projection effect. */
export interface TaskProjectionGrant extends DurableAuthorizationEvidence {
  readonly projectId: string
}

export interface TaskProjectionTarget {
  readonly projectId: string
  readonly authorization: TaskProjectionGrant
}
