import type { ExecutorCapabilityReportV1 } from './contracts.js'
import { validateExecutorCapabilityReport } from './validation.js'

export type InstalledExecutorIdV1 = 'claude-code' | 'codex' | 'dsh'
export type ProbeAuthenticationStateV1 = 'ready' | 'required' | 'unknown'

export interface FixedExecutorProbeSpecV1 {
  readonly schemaVersion: 1
  readonly executorId: InstalledExecutorIdV1
  readonly command: string
  readonly args: readonly string[]
  readonly minimumVersion: string
  readonly timeoutMs: number
  readonly protocolVersions: readonly ['envelope.v1']
  readonly capabilities: readonly string[]
}

/**
 * Bounded observation returned by a future host adapter. The adapter must
 * discard process output after this pure classifier returns.
 */
export interface FixedExecutorProbeObservationV1 {
  readonly state: 'completed' | 'not-found' | 'timed-out'
  readonly exitCode: number | null
  readonly output: string
  readonly authentication: ProbeAuthenticationStateV1
}

const semanticVersion = /(?:^|[^0-9])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:$|[^0-9A-Za-z.-])/
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const safeDeviceId = /^[a-z0-9][a-z0-9.-]{0,63}$/
const maxProbeOutputLength = 4_096
const reportLifetimeMs = 5 * 60_000

const probeSpecs: readonly FixedExecutorProbeSpecV1[] = deepFreeze([
  {
    schemaVersion: 1,
    executorId: 'claude-code',
    command: 'claude',
    args: ['--version'],
    minimumVersion: '0.1.0',
    timeoutMs: 5_000,
    protocolVersions: ['envelope.v1'],
    capabilities: ['agent.execute', 'tool.execute', 'session.continue'],
  },
  {
    schemaVersion: 1,
    executorId: 'codex',
    command: 'codex',
    args: ['--version'],
    minimumVersion: '0.1.0',
    timeoutMs: 5_000,
    protocolVersions: ['envelope.v1'],
    capabilities: ['agent.execute', 'tool.execute', 'session.continue'],
  },
  {
    schemaVersion: 1,
    executorId: 'dsh',
    command: 'dsh',
    args: ['--version'],
    minimumVersion: '0.1.0',
    timeoutMs: 5_000,
    protocolVersions: ['envelope.v1'],
    capabilities: ['agent.execute', 'tool.execute'],
  },
])

/** Returns the only process commands that an approved pilot adapter may run. */
export function fixedExecutorProbeSpecs(): readonly FixedExecutorProbeSpecV1[] {
  return probeSpecs
}

/**
 * Pure, inactive classifier. It cannot spawn a process and never includes raw
 * command output, executable paths, account identifiers or auth material in its report.
 */
export function classifyFixedExecutorProbe(
  spec: FixedExecutorProbeSpecV1,
  observation: FixedExecutorProbeObservationV1,
  deviceId: string,
  now: Date,
): ExecutorCapabilityReportV1 {
  validateSpec(spec)
  if (!safeDeviceId.test(deviceId) || Number.isNaN(now.getTime())) throw new Error('executor probe scope is invalid')
  if (!['completed', 'not-found', 'timed-out'].includes(observation.state) || !['ready', 'required', 'unknown'].includes(observation.authentication)) throw new Error('executor probe observation is invalid')
  if ((observation.state === 'completed') !== (observation.exitCode !== null)) throw new Error('executor probe completion and exit code disagree')
  if (observation.output.length > maxProbeOutputLength || observation.output.includes('\0')) throw new Error('executor probe output is not bounded')
  if (observation.exitCode !== null && (!Number.isSafeInteger(observation.exitCode) || observation.exitCode < 0)) throw new Error('executor probe exit code is invalid')

  let availability: ExecutorCapabilityReportV1['availability'] = 'unavailable'
  let version: string | null = null
  if (observation.state === 'not-found') {
    availability = 'not-installed'
  } else if (observation.state === 'completed' && observation.exitCode === 0) {
    version = semanticVersion.exec(observation.output)?.[1] ?? null
    if (version && compareVersions(version, spec.minimumVersion) < 0) availability = 'version-unsupported'
    else if (version && observation.authentication === 'required') availability = 'auth-required'
    else if (version && observation.authentication === 'ready') availability = 'ready'
  }

  return validateExecutorCapabilityReport(deepFreeze({
    schemaVersion: 1,
    deviceId,
    executorId: spec.executorId,
    availability,
    version,
    protocolVersions: availability === 'ready' ? [...spec.protocolVersions] : [],
    capabilities: availability === 'ready' ? [...spec.capabilities] : [],
    constraints: ['local-only', 'no-mid-action-switch'],
    discoveredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + reportLifetimeMs).toISOString(),
  }))
}

function validateSpec(spec: FixedExecutorProbeSpecV1): void {
  const canonical = probeSpecs.find(candidate => candidate.executorId === spec.executorId)
  if (!canonical || JSON.stringify(spec) !== JSON.stringify(canonical)) throw new Error('executor probe must match the fixed allowlist')
  if (!exactVersion.test(spec.minimumVersion)) throw new Error('executor minimum version is invalid')
}

function compareVersions(left: string, right: string): number {
  const numbers = (value: string) => value.split('-', 1)[0]!.split('.').map(part => Number.parseInt(part, 10))
  const a = numbers(left)
  const b = numbers(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0)
  }
  return 0
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
