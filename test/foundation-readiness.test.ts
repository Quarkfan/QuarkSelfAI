import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateFoundation } from '../scripts/audit-foundation-readiness.js'

const config = {
  schemaVersion: 1,
  projectId: 'quarkselfai',
  phases: [
    { id: 'information-organization', gates: ['repository-recovery-prerequisites', 'assistant-continuity-inventory', 'capability-evolution-blueprint', 'private-work-remote', 'work-integration-isolated'] },
    { id: 'portable-sqlite-recovery', gates: ['cold-clone-restore-safe-rehearsal', 'online-account-readiness', 'cross-device-recovery-rehearsal'] },
    { id: 'postgres-compatibility', gates: ['postgres-empty-database-rehearsal'] },
    { id: 'single-writer-takeover', gates: ['approved-single-writer-rehearsal'] },
  ],
  evidence: {
    coldCloneRestoreSafe: 'docs/evidence/cold.md',
    crossDeviceRecovery: 'docs/evidence/device.md',
    postgresRecovery: 'docs/evidence/postgres.md',
    singleWriterTakeover: 'docs/evidence/takeover.md',
  },
}

test('reports each missing external proof without hiding passed local foundations', () => {
  const report = evaluateFoundation(config, {
    recoveryOk: true,
    continuityOk: true,
    continuityOutstanding: ['private-work-integration-remote', 'work-integration-not-yet-isolated'],
    evolutionBlueprintOk: true,
    accountAuditRequested: false,
    accountAuditOk: false,
    trackedPaths: new Set(['docs/evidence/cold.md']),
  })
  assert.equal(report.ok, false)
  assert.equal(report.organizationComplete, false)
  assert.equal(report.portableRecoveryProven, false)
  assert.equal(report.phases[0]?.status, 'blocked')
  assert.equal(report.phases[1]?.status, 'blocked')
  assert.ok(report.blockers.includes('private-work-remote:private-work-remote-unprovided'))
  assert.ok(report.blockers.includes('cross-device-recovery-rehearsal:cross-device-rehearsal-missing'))
  assert.ok(report.unverified.includes('online-account-readiness:online-account-audit-not-requested'))
})

test('passes only when every distinct phase has authoritative evidence', () => {
  const report = evaluateFoundation(config, {
    recoveryOk: true,
    continuityOk: true,
    continuityOutstanding: [],
    evolutionBlueprintOk: true,
    accountAuditRequested: true,
    accountAuditOk: true,
    trackedPaths: new Set(Object.values(config.evidence)),
  })
  assert.equal(report.ok, true)
  assert.equal(report.organizationComplete, true)
  assert.equal(report.portableRecoveryProven, true)
  assert.deepEqual(report.blockers, [])
  assert.deepEqual(report.unverified, [])
})
