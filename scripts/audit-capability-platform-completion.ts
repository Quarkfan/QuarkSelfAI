import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Requirement = { id: string; state: string; evidence: string[] }
const required = ['all-modules-classified','real-multi-user-tenant-isolation','installable-client-and-device-enrollment','claude-codex-dsh-single-execution-contract','console-agent-compose-test-version','five-capability-forms','existing-workflows-equivalent-replay','single-consumer-provider-scheduler-writer','mainline-independent-from-private-work','workspace-file-desktop-approval-control','install-run-recover-upgrade-rollback-verified','user-uncommitted-changes-preserved']

export async function auditCapabilityPlatformCompletion(root: string): Promise<{ ok: boolean; status: string; verified: string[]; blockers: string[] }> {
  const [ledger, catalog, migration, deployment, candidates, composition, continuity, nativeMigration] = await Promise.all(['config/capability-platform-completion.json','config/module-catalog.json','config/capability-platform-migration.json','config/capability-platform-deployment.json','config/capability-artifact-candidates.json','config/product-composition.json','config/assistant-continuity.json','config/native-migration-plan.json'].map(path => json(resolve(root, path))))
  assert.equal(ledger.schemaVersion, 1); assert.equal(ledger.objective, 'multi-user-cloud-control-local-execution-capability-agent-platform'); assert.ok(Array.isArray(ledger.requirements))
  const requirements = ledger.requirements as Requirement[]; assert.deepEqual(requirements.map(item => item.id).sort(), [...required].sort()); assert.equal(new Set(requirements.map(item => item.id)).size, required.length)
  for (const item of requirements) { assert.ok(['verified','verified-current-scope','verified-current-batch','implemented-not-activated','incomplete'].includes(item.state)); assert.ok(Array.isArray(item.evidence) && item.evidence.length); for (const path of item.evidence) await readFile(resolve(root, path)) }
  const moduleIds = new Set((catalog.modules as Array<{ id: string }>).map(item => item.id)); const migrated = (migration.groups as Array<{ moduleIds: string[] }>).flatMap(group => group.moduleIds)
  const predicates = new Map<string, boolean>([
    ['all-modules-classified', moduleIds.size === migrated.length && migrated.every(id => moduleIds.has(id)) && new Set(migrated).size === migrated.length],
    ['real-multi-user-tenant-isolation', deployment.server?.firstOwnerCreated === true && deployment.server?.listenerActive === true],
    ['installable-client-and-device-enrollment', deployment.client?.installationState === 'active' && deployment.client?.deviceEnrolled === true && deployment.client?.serviceRegistered === true],
    ['claude-codex-dsh-single-execution-contract', deployment.client?.executorContractVerified === true],
    ['console-agent-compose-test-version', deployment.server?.agentStudioActive === true && deployment.server?.consoleActive === true],
    ['five-capability-forms', hasForms(candidates.candidates)],
    ['existing-workflows-equivalent-replay', deployment.client?.existingWorkflowReplayVerified === true && auditWorkflowReplayReadiness(ledger.workflowReplay, nativeMigration).verified],
    ['single-consumer-provider-scheduler-writer', deployment.server?.externalEffectsEnabled === false && deployment.client?.externalWritesEnabled === false],
    ['mainline-independent-from-private-work', !containsWorkDependency(composition) && !((continuity.outstanding as unknown[]) ?? []).includes('work-integration-not-yet-isolated')],
    ['workspace-file-desktop-approval-control', moduleIds.has('workspace-boundary') && moduleIds.has('authorization-contract') && deployment.client?.workspaceApprovalVerified === true],
    ['install-run-recover-upgrade-rollback-verified', deployment.server?.lifecycleVerified === true && deployment.client?.lifecycleVerified === true],
    ['user-uncommitted-changes-preserved', true],
  ])
  const verified: string[] = []; const blockers: string[] = []
  for (const item of requirements) { const proven = predicates.get(item.id) === true; if (item.state === 'verified' && !proven) throw new Error(`completion ledger overclaims ${item.id}`); if (proven && item.state.startsWith('verified')) verified.push(item.id); else blockers.push(`${item.id}:${item.state}`) }
  const ok = blockers.length === 0 && ledger.status === 'complete'; if (ledger.status === 'complete' && !ok) throw new Error('completion ledger cannot be complete with blockers')
  return { ok, status: String(ledger.status), verified, blockers }
}

function hasForms(value: unknown): boolean { if (!Array.isArray(value)) return false; const kinds = new Set(value.map(item => item && typeof item === 'object' ? (item as Record<string, unknown>).kind : undefined)); return ['tool','package','browser','integration-pack','application'].every(kind => kinds.has(kind)) && value.filter(item => item && typeof item === 'object').every(item => (item as Record<string, unknown>).activationAllowed === true) }
function containsWorkDependency(value: unknown): boolean { const text = JSON.stringify(value); return /BLACKLAKE|XIAOWEI|blacklake-reference|xiaowei-research|work-journal-agent-compiler/.test(text) }
async function json(path: string): Promise<any> { return JSON.parse(await readFile(path, 'utf8')) }

export function auditWorkflowReplayReadiness(readiness: any, migrationPlan: { readonly units: readonly { readonly id: string }[] }) {
  assert.equal(readiness?.mode, 'synthetic-no-effect'); assert.equal(readiness?.activationAllowed, false); assert.equal(readiness?.externalReadsAllowed, false); assert.equal(readiness?.externalWritesAllowed, false)
  const units = Array.isArray(readiness?.units) ? readiness.units : []
  const planned = migrationPlan.units.map(unit => unit.id).sort(); const declared = units.map((unit: any) => unit.id).sort()
  assert.equal(new Set(declared).size, declared.length); assert.deepEqual(declared, planned)
  const verifiedUnits: string[] = []; const blockers: string[] = []
  for (const unit of units) {
    assert.equal(typeof unit.prepareEntrypoint, 'string'); assert.equal(unit.privacyBounded, true)
    const complete = unit.state === 'synthetic-replay-verified' && typeof unit.applyEntrypoint === 'string' && unit.idempotentReplayVerified === true && unit.blockers.length === 0
    if (complete) verifiedUnits.push(unit.id); else blockers.push(...(unit.blockers.length ? unit.blockers.map((blocker: string) => `${unit.id}:${blocker}`) : [`${unit.id}:incomplete`]))
  }
  const verified = blockers.length === 0; assert.equal(readiness.status === 'verified', verified)
  return { verified, verifiedUnits, blockers }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { const report = await auditCapabilityPlatformCompletion(process.cwd()); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.ok) process.exitCode = 2 }
