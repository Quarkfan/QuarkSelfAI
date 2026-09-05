import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { auditAccountBootstrap } from './audit-account-bootstrap.js'
import { auditAssistantContinuity } from './audit-assistant-continuity.js'
import { auditCapabilityEvolutionPortability } from './audit-capability-evolution-portability.js'
import { auditRecoveryReadiness } from './audit-recovery-readiness.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type GateStatus = 'passed' | 'blocked' | 'unverified'
type Gate = { id: string; status: GateStatus; reason: string }

type AcceptanceConfig = {
  schemaVersion: number
  projectId: string
  phases: Array<{ id: string; gates: string[] }>
  evidence: {
    coldCloneRestoreSafe: string
    crossDeviceRecovery: string
    postgresRecovery: string
    singleWriterTakeover: string
  }
}

export type FoundationInputs = {
  recoveryOk: boolean
  continuityOk: boolean
  continuityOutstanding: string[]
  evolutionBlueprintOk: boolean
  accountAuditRequested: boolean
  accountAuditOk: boolean
  trackedPaths: Set<string>
}

function evidenceGate(id: string, path: string, tracked: Set<string>, missingReason: string): Gate {
  return tracked.has(path)
    ? { id, status: 'passed', reason: 'tracked-evidence-present' }
    : { id, status: 'blocked', reason: missingReason }
}

export function evaluateFoundation(config: AcceptanceConfig, inputs: FoundationInputs) {
  if (config.schemaVersion !== 1 || config.projectId !== 'quarkselfai' || !Array.isArray(config.phases)) {
    throw new Error('foundation acceptance config is invalid')
  }
  const outstanding = new Set(inputs.continuityOutstanding)
  const gates: Gate[] = [
    { id: 'repository-recovery-prerequisites', status: inputs.recoveryOk ? 'passed' : 'blocked', reason: inputs.recoveryOk ? 'recovery-audit-passed' : 'recovery-audit-failed' },
    { id: 'assistant-continuity-inventory', status: inputs.continuityOk ? 'passed' : 'blocked', reason: inputs.continuityOk ? 'continuity-audit-passed' : 'continuity-audit-failed' },
    { id: 'capability-evolution-blueprint', status: inputs.evolutionBlueprintOk ? 'passed' : 'blocked', reason: inputs.evolutionBlueprintOk ? 'portable-blueprint-passed' : 'portable-blueprint-failed' },
    { id: 'private-work-remote', status: outstanding.has('private-work-integration-remote') ? 'blocked' : 'passed', reason: outstanding.has('private-work-integration-remote') ? 'private-work-remote-unprovided' : 'private-work-remote-recorded' },
    { id: 'work-integration-isolated', status: outstanding.has('work-integration-not-yet-isolated') ? 'blocked' : 'passed', reason: outstanding.has('work-integration-not-yet-isolated') ? 'work-integration-migration-incomplete' : 'work-integration-isolated' },
    evidenceGate('cold-clone-restore-safe-rehearsal', config.evidence.coldCloneRestoreSafe, inputs.trackedPaths, 'cold-clone-rehearsal-missing'),
    {
      id: 'online-account-readiness',
      status: !inputs.accountAuditRequested ? 'unverified' : (inputs.accountAuditOk ? 'passed' : 'blocked'),
      reason: !inputs.accountAuditRequested ? 'online-account-audit-not-requested' : (inputs.accountAuditOk ? 'online-account-audit-passed' : 'online-account-audit-failed'),
    },
    evidenceGate('cross-device-recovery-rehearsal', config.evidence.crossDeviceRecovery, inputs.trackedPaths, 'cross-device-rehearsal-missing'),
    evidenceGate('postgres-empty-database-rehearsal', config.evidence.postgresRecovery, inputs.trackedPaths, 'postgres-rehearsal-missing'),
    evidenceGate('approved-single-writer-rehearsal', config.evidence.singleWriterTakeover, inputs.trackedPaths, 'single-writer-rehearsal-missing'),
  ]
  const gateMap = new Map(gates.map(gate => [gate.id, gate]))
  const configuredGateIds = config.phases.flatMap(phase => phase.gates)
  if (new Set(configuredGateIds).size !== configuredGateIds.length || configuredGateIds.some(id => !gateMap.has(id))) {
    throw new Error('foundation acceptance phases contain missing or duplicate gates')
  }
  if (gates.some(gate => !configuredGateIds.includes(gate.id))) throw new Error('foundation acceptance has unassigned gates')
  const phases = config.phases.map(phase => {
    const phaseGates = phase.gates.map(id => gateMap.get(id) as Gate)
    const status: GateStatus = phaseGates.some(gate => gate.status === 'blocked')
      ? 'blocked'
      : phaseGates.some(gate => gate.status === 'unverified') ? 'unverified' : 'passed'
    return { id: phase.id, status, gates: phaseGates }
  })
  const blockers = gates.filter(gate => gate.status === 'blocked').map(gate => `${gate.id}:${gate.reason}`)
  const unverified = gates.filter(gate => gate.status === 'unverified').map(gate => `${gate.id}:${gate.reason}`)
  return {
    ok: blockers.length === 0 && unverified.length === 0,
    projectId: config.projectId,
    organizationComplete: phases.find(phase => phase.id === 'information-organization')?.status === 'passed',
    portableRecoveryProven: phases.every(phase => phase.status === 'passed'),
    phases,
    blockers,
    unverified,
    privacy: { credentialValuesIncluded: false, accountIdentifiersIncluded: false, businessContentIncluded: false },
  }
}

function trackedPaths(root: string): Set<string> {
  return new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean))
}

export async function auditFoundationReadiness(root = projectRoot, online = false) {
  const config = JSON.parse(await readFile(resolve(root, 'config/foundation-acceptance.json'), 'utf8')) as AcceptanceConfig
  const [recovery, continuity, evolution, accounts] = await Promise.all([
    auditRecoveryReadiness(root),
    auditAssistantContinuity(root),
    auditCapabilityEvolutionPortability({ projectRoot: root }),
    online ? auditAccountBootstrap({ projectRoot: root, environment: process.env, online: true }) : Promise.resolve(null),
  ])
  return evaluateFoundation(config, {
    recoveryOk: recovery.ok,
    continuityOk: continuity.ok,
    continuityOutstanding: continuity.outstanding,
    evolutionBlueprintOk: evolution.blueprint.valid,
    accountAuditRequested: online,
    accountAuditOk: accounts?.ok ?? false,
    trackedPaths: trackedPaths(root),
  })
}

async function main(): Promise<void> {
  const report = await auditFoundationReadiness(projectRoot, process.argv.includes('--online'))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
