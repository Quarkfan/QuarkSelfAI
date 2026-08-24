export interface OverdueTask {
  readonly taskId: string
  readonly title: string
  readonly dueDate: string
  readonly priority: number
  readonly url?: string
}

export interface DeletedTask {
  readonly taskId: string
  readonly title: string
  readonly completedAt: string
}

export interface DidaMaintenanceConfig {
  readonly enabled?: boolean
  readonly projectId: string
  readonly overdueIntervalMs?: number
  readonly overdueRetryMs?: number
  readonly failureNotifyThreshold?: number
  readonly cleanupTimeZone?: string
  readonly cleanupHour?: number
  readonly cleanupPollIntervalMs?: number
  readonly cleanupFailureNotifyThreshold?: number
  readonly completedRetentionDays?: number
  readonly cleanupMaxPerRun?: number
}
