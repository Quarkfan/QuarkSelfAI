import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExecutorCapabilityReportV1, ExecutorDiscoveryProbeV1 } from './contracts.js'
import { discoverBundledDsh, type BundledDshReportV1 } from './bundled-dsh-discovery.js'
import { InactiveExecutorDiscoveryV1 } from './discovery.js'
import { classifyAuthReadiness, NodeFixedAuthProbeRunnerV1, type AuthProbeExecutorIdV1, type FixedAuthProbeRunnerV1 } from './executor-readiness-probe.js'
import { NodeFixedProcessProbeRunnerV1, type FixedProcessProbeRunnerV1 } from './host-process-probe.js'
import { classifyFixedExecutorProbe, fixedExecutorProbeSpecs, type FixedExecutorProbeSpecV1 } from './process-discovery.js'

const reportLifetimeMs = 5 * 60_000
const defaultRuntimeRoot = fileURLToPath(new URL('../..', import.meta.url))

export interface InstalledExecutorDiscoveryDependenciesV1 {
  readonly versionRunner?: FixedProcessProbeRunnerV1
  readonly authRunner?: FixedAuthProbeRunnerV1
  readonly bundledDshDiscovery?: (runtimeRoot: string) => Promise<BundledDshReportV1>
  readonly runtimeRoot?: string
}

/**
 * Explicit, read-only host discovery composition for Claude Code, Codex and the
 * repository-bundled DSH fallback. Construction and client initialization do
 * not invoke it; callers must request one refresh for an absolute workspace.
 */
export class NodeInstalledExecutorDiscoveryV1 extends InactiveExecutorDiscoveryV1 {
  constructor(cwd: string, dependencies: InstalledExecutorDiscoveryDependenciesV1 = {}) {
    if (!isAbsolute(cwd) || resolve(cwd) !== cwd) throw new Error('executor discovery workspace must be an exact absolute path')
    const runtimeRoot = dependencies.runtimeRoot ?? defaultRuntimeRoot
    if (!isAbsolute(runtimeRoot) || resolve(runtimeRoot) !== runtimeRoot) throw new Error('executor discovery runtime root must be an exact absolute path')
    const versionRunner = dependencies.versionRunner ?? new NodeFixedProcessProbeRunnerV1()
    const authRunner = dependencies.authRunner ?? new NodeFixedAuthProbeRunnerV1()
    const bundledDshDiscovery = dependencies.bundledDshDiscovery ?? discoverBundledDsh
    const specs = fixedExecutorProbeSpecs()
    super([
      installedToolProbe(findSpec(specs, 'claude-code'), cwd, versionRunner, authRunner),
      installedToolProbe(findSpec(specs, 'codex'), cwd, versionRunner, authRunner),
      bundledDshProbe(runtimeRoot, bundledDshDiscovery),
    ])
  }
}

function installedToolProbe(
  spec: FixedExecutorProbeSpecV1 & { readonly executorId: AuthProbeExecutorIdV1 },
  cwd: string,
  versionRunner: FixedProcessProbeRunnerV1,
  authRunner: FixedAuthProbeRunnerV1,
): ExecutorDiscoveryProbeV1 {
  return Object.freeze({
    executorId: spec.executorId,
    async inspect(deviceId: string, now: Date): Promise<ExecutorCapabilityReportV1> {
      try {
        const version = await versionRunner.run(spec.executorId)
        const authentication = version.state === 'completed' && version.exitCode === 0
          ? classifyAuthReadiness(spec.executorId, await authRunner.run(spec.executorId, cwd))
          : 'unknown'
        return classifyFixedExecutorProbe(spec, { ...version, authentication }, deviceId, now)
      } catch {
        return classifyFixedExecutorProbe(spec, { state: 'completed', exitCode: 1, output: '', authentication: 'unknown' }, deviceId, now)
      }
    },
  })
}

function bundledDshProbe(runtimeRoot: string, inspect: (runtimeRoot: string) => Promise<BundledDshReportV1>): ExecutorDiscoveryProbeV1 {
  return Object.freeze({
    executorId: 'dsh',
    async inspect(deviceId: string, now: Date): Promise<ExecutorCapabilityReportV1> {
      try { return dshCapabilityReport(deviceId, now, await inspect(runtimeRoot)) }
      catch { return dshCapabilityReport(deviceId, now, null) }
    },
  })
}

function dshCapabilityReport(deviceId: string, now: Date, source: BundledDshReportV1 | null): ExecutorCapabilityReportV1 {
  const availability: ExecutorCapabilityReportV1['availability'] = source?.installation === 'detected'
    ? source.authentication === 'ready' ? 'ready' : 'auth-required'
    : source?.installation === 'not-detected' ? 'not-installed' : 'unavailable'
  return Object.freeze({
    schemaVersion: 1,
    deviceId,
    executorId: 'dsh',
    availability,
    version: source?.version ?? null,
    protocolVersions: availability === 'ready' ? [...source!.protocolVersions] : [],
    capabilities: availability === 'ready' ? [...source!.capabilities] : [],
    constraints: ['local-only', 'bundled-fallback', 'no-mid-action-switch'],
    discoveredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + reportLifetimeMs).toISOString(),
  })
}

function findSpec(specs: readonly FixedExecutorProbeSpecV1[], executorId: AuthProbeExecutorIdV1): FixedExecutorProbeSpecV1 & { readonly executorId: AuthProbeExecutorIdV1 } {
  const spec = specs.find(candidate => candidate.executorId === executorId)
  if (!spec) throw new Error(`fixed executor probe is missing: ${executorId}`)
  return spec as FixedExecutorProbeSpecV1 & { readonly executorId: AuthProbeExecutorIdV1 }
}
