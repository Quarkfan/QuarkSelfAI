import type { DurableAuthorizationEvidence } from '../domain/authorization.js'

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
  readonly overdueNotificationTimeZone?: string
  readonly overdueNotificationStartHour?: number
  readonly overdueNotificationEndHour?: number
  readonly overdueReminderMinimumIntervalMs?: number
  readonly cleanupTimeZone?: string
  readonly cleanupHour?: number
  readonly cleanupPollIntervalMs?: number
  readonly cleanupFailureNotifyThreshold?: number
  readonly completedRetentionDays?: number
  readonly cleanupMaxPerRun?: number
  readonly cleanupAuthorization?: DurableAuthorizationEvidence & {
    readonly projectId: string
    readonly minimumRetentionDays: number
    readonly maximumDeletesPerRun: number
  }
}
