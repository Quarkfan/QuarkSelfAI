/**
 * Replaceable task-store capabilities.
 *
 * These effects describe task persistence and queries only. They must not decide
 * whether a message deserves a task, rewrite assistant summaries, or choose who
 * should be reminded.
 */
export const TASK_STORE_EFFECTS = {
  listOverdue: 'task-store.list-overdue.v1',
  isCompleted: 'task-store.is-completed.v1',
} as const
