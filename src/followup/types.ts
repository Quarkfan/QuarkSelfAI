export const FOLLOWUP_EFFECTS = { openOutreach: 'followup.open-outreach.v1' } as const
export interface FollowupReviewConfig {
  readonly enabled?: boolean
  readonly timeZone?: string
  readonly scheduledHour?: number
  readonly pollIntervalMs?: number
}
export interface FollowupReminder { readonly taskId: string; readonly title: string; readonly urgency: 'low' | 'medium' | 'high'; readonly reason: string; readonly recommendedAction: string; readonly url?: string }
export interface FollowupUpdate { readonly taskId: string; readonly title: string; readonly changes: readonly string[]; readonly reason: string; readonly url?: string }
export interface FollowupOutreachInput extends Readonly<Record<string, unknown>> { readonly taskId: string; readonly title: string; readonly personName?: string; readonly personOpenId?: string; readonly question: string; readonly reason: string; readonly context: string; readonly url?: string }
export interface FollowupContact { readonly openId: string; readonly name: string; readonly department?: string; readonly email?: string; readonly external: boolean }
export interface FollowupOutreachConfig { readonly enabled?: boolean; readonly retryBaseMs?: number; readonly retryMaxMs?: number; readonly failureNotifyThreshold?: number }
export interface FollowupReplyInput { readonly messageId: string; readonly content: string; readonly receivedAt: string; readonly url?: string }
