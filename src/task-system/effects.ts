/** Stable task-system capabilities supplied by a TickTick, Feishu Task, or other adapter. */
export const TASK_EFFECTS = {
  listOverdue: 'task-system.list-overdue.v1',
  cleanupCompleted: 'task-system.cleanup-completed.v1',
  isCompleted: 'task-system.is-completed.v1',
} as const
