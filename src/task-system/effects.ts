/** Stable task-system capabilities supplied by a TickTick, Feishu Task, or other adapter. */
export const TASK_EFFECTS = {
  listOverdue: 'task-system.list-overdue.v1',
  cleanupCompleted: 'task-system.cleanup-completed.v1',
  isCompleted: 'task-system.is-completed.v1',
  recordResearchResult: 'task-system.record-research-result.v1',
  evaluateFollowups: 'task-system.evaluate-followups.v1',
  recordFollowupReply: 'task-system.record-followup-reply.v1',
} as const
