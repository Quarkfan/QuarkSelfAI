export type NetworkRecoveryStep =
  | 'probe'
  | 'disable-clash'
  | 'switch-calvin'
  | 'switch-blacklake'
  | 'enable-blacklake-route'

export interface ConnectivityProbe {
  readonly currentGoogle: boolean
  readonly directGoogle: boolean
  readonly codex: boolean
  readonly feishu: boolean
  readonly blacklake: boolean
  readonly observedAt: string
  readonly detail?: string
}
export interface NetworkRecoveryAttempt {
  readonly step: NetworkRecoveryStep
  readonly probe?: ConnectivityProbe
  readonly changed?: boolean
  readonly detail?: string
}

export interface NetworkRecoveryReport {
  readonly outcome: 'healthy' | 'recovered' | 'failed' | 'skipped'
  readonly startedAt: string
  readonly completedAt: string
  readonly attempts: readonly NetworkRecoveryAttempt[]
  readonly notificationRequired: boolean
  readonly reason: string
}

export interface ExecutorInfrastructureFailureSignal {
  readonly actionId: string
  readonly attempt: number
  readonly error: string
  readonly occurredAt: string
}

export interface NetworkRecoveryConfig {
  readonly enabled?: boolean
  readonly mutationsEnabled?: boolean
  readonly minimumExecutorAttempts?: number
  readonly cooldownMs?: number
  readonly helperExecutable?: string
  readonly googleUrl?: string
  readonly codexUrl?: string
  readonly feishuUrl?: string
  readonly blacklakeUrl?: string
}
