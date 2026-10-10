import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { auditWorkflowReplayReadiness } from '../scripts/audit-capability-platform-completion.js'

test('covers every migration unit and keeps workflow replay incomplete until message intake can be imported', async () => {
  const readiness = JSON.parse(await readFile(new URL('../config/capability-platform-completion.json', import.meta.url), 'utf8')).workflowReplay
  const migration = JSON.parse(await readFile(new URL('../config/native-migration-plan.json', import.meta.url), 'utf8'))
  const report = auditWorkflowReplayReadiness(readiness, migration)
  assert.equal(report.verified, false)
  assert.equal(report.verifiedUnits.length, 6)
  assert.deepEqual(report.blockers, ['message-intake-and-projection:non-empty pending queues are counted but not imported into native durable events and workflows'])
})

test('rejects an effectful or coverage-drifted replay claim', async () => {
  const readiness = JSON.parse(await readFile(new URL('../config/capability-platform-completion.json', import.meta.url), 'utf8')).workflowReplay
  const migration = JSON.parse(await readFile(new URL('../config/native-migration-plan.json', import.meta.url), 'utf8'))
  assert.throws(() => auditWorkflowReplayReadiness({ ...readiness, externalWritesAllowed: true }, migration))
  assert.throws(() => auditWorkflowReplayReadiness({ ...readiness, units: readiness.units.slice(1) }, migration))
})
