import { createHash } from 'node:crypto'
import type { FollowupReviewConfig } from '../followup/types.js'
import type { SessionLifecycleConfig } from '../session-lifecycle/types.js'
import type { DidaMaintenanceConfig } from '../task-maintenance/types.js'
import type { XiaoweiResearchConfig } from '../xiaowei/types.js'

type CompatibilityConfig = Readonly<Record<string, unknown>>

export function auditResourceHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function didaMaintenanceAuditConfig(config: CompatibilityConfig): DidaMaintenanceConfig {
  const projectId = requiredText(config.didaProjectId, 'compat config has no didaProjectId')
  const overdueIntervalMs = number(config.overduePollIntervalMs)
  const overdueRetryMs = number(config.overdueRetryIntervalMs)
  const failureNotifyThreshold = number(config.overdueFailureNotifyThreshold)
  const cleanupTimeZone = text(config.didaCompletedCleanupTimeZone)
  const cleanupHour = number(config.didaCompletedCleanupHour)
  const cleanupPollIntervalMs = number(config.didaCompletedCleanupIntervalMs)
  const cleanupFailureNotifyThreshold = number(config.didaCompletedCleanupFailureNotifyThreshold)
  const completedRetentionDays = number(config.didaCompletedRetentionDays)
  const cleanupMaxPerRun = number(config.didaCompletedCleanupMaxPerRun)
  return {
    projectId,
    ...(overdueIntervalMs !== undefined ? { overdueIntervalMs } : {}),
    ...(overdueRetryMs !== undefined ? { overdueRetryMs } : {}),
    ...(failureNotifyThreshold !== undefined ? { failureNotifyThreshold } : {}),
    ...(cleanupTimeZone ? { cleanupTimeZone } : {}),
    ...(cleanupHour !== undefined ? { cleanupHour } : {}),
    ...(cleanupPollIntervalMs !== undefined ? { cleanupPollIntervalMs } : {}),
    ...(cleanupFailureNotifyThreshold !== undefined ? { cleanupFailureNotifyThreshold } : {}),
    ...(completedRetentionDays !== undefined ? { completedRetentionDays } : {}),
    ...(cleanupMaxPerRun !== undefined ? { cleanupMaxPerRun } : {}),
    cleanupAuthorization: {
      id: 'owner-policy:dida-completed-cleanup:v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00+08:00',
      scope: 'dida.completed-task-cleanup', revision: 1,
      source: 'owner-directive:periodically-clean-completed-automation-tasks',
      projectId, minimumRetentionDays: 30, maximumDeletesPerRun: 50,
    },
  }
}

export function sessionLifecycleAuditConfig(config: CompatibilityConfig): SessionLifecycleConfig {
  const pollIntervalMs = number(config.sessionCleanupIntervalMs)
  const retryBaseMs = number(config.sessionRetryBaseMs)
  const retryMaxMs = number(config.sessionRetryMaxMs)
  const deleteAfterDays = number(config.sessionDeleteAfterDays)
  return {
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(retryBaseMs !== undefined ? { retryBaseMs } : {}),
    ...(retryMaxMs !== undefined ? { retryMaxMs } : {}),
    ...(deleteAfterDays !== undefined ? { deleteAfterDays } : {}),
    authorization: {
      id: 'owner-policy:codex-auto-research-session-lifecycle:v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00+08:00',
      scope: 'codex.auto-research-session-lifecycle', revision: 1,
      source: 'owner-directive:archive-completed-and-delete-after-one-week', minimumArchivedDays: 7,
    },
  }
}

export function xiaoweiResearchAuditConfig(config: CompatibilityConfig): XiaoweiResearchConfig {
  const agent = record(config.xiaoweiAgent)
  const agentName = text(agent.name)
  return {
    ...(agentName ? { agentName } : {}),
    agentOpenId: requiredText(agent.openId, 'compat config has no Xiaowei identity'),
    agentChatId: requiredText(agent.chatId, 'compat config has no Xiaowei identity'),
    retryBaseMs: 120_000,
    retryMaxMs: 3_600_000,
  }
}

export function followupAuditConfig(config: CompatibilityConfig): FollowupReviewConfig & { readonly projectId: string } {
  const projectId = requiredText(config.followupProjectId, 'compat config has no followupProjectId')
  const timeZone = text(config.followupTimeZone)
  const scheduledHour = number(config.followupScheduledHour)
  const pollIntervalMs = number(config.followupPollIntervalMs)
  return {
    projectId,
    taskProjection: {
      projectId,
      authorization: {
        id: 'owner-policy:dida-followup-projection:v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00+08:00',
        scope: 'dida.task-projection', revision: 1,
        source: 'owner-directive:delegate-followup-task-management', projectId,
      },
    },
    ...(timeZone ? { timeZone } : {}),
    ...(scheduledHour !== undefined ? { scheduledHour } : {}),
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requiredText(value: unknown, message: string): string {
  const parsed = text(value)
  if (!parsed) throw new Error(message)
  return parsed
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
