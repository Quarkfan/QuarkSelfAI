import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PolicyAuthoringService } from '../src/collaboration/policy-authoring.js'
import type { PolicySample } from '../src/policy/types.js'
import type { AssistantPolicyDocument } from '../src/collaboration/policy-model.js'
import { createSqliteStore } from '../src/storage/sqlite.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))
const policyId = '6f5192d4-a7a7-5c12-a6ea-202608220001'
const source = '当消息全文等于固定合成短语 QUARK_REHEARSAL_NOISE_20260822 时进入汇总；仅用于接管演练。'
const samples: PolicySample[] = Array.from({ length: 20 }, (_, index) => ({
  id: `synthetic-${index}`,
  facts: {
    message: { text: index === 0 ? 'QUARK_REHEARSAL_NOISE_20260822' : `QUARK_REHEARSAL_CONTROL_${index}` },
    urgency: 'normal',
  },
}))
const revisionOne: AssistantPolicyDocument = {
  version: 1,
  name: '接管演练固定短语汇总',
  description: '只匹配固定合成短语，不影响普通业务消息。',
  priority: 1,
  when: { fact: 'message.text', op: 'eq', value: 'QUARK_REHEARSAL_NOISE_20260822' },
  effect: { attention: 'batch', addTags: ['接管演练'] },
}
const revisionTwo: AssistantPolicyDocument = {
  ...revisionOne,
  description: '第二 revision：仍只匹配同一个固定合成短语。',
  effect: { attention: 'batch', settleMinutes: 5, addTags: ['接管演练'] },
}

const directory = await mkdtemp(join(tmpdir(), 'quark-policy-rehearsal-'))
const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
try {
  await store.migrate()
  const authoring = new PolicyAuthoringService(store, { async compile() { throw new Error('compiler is not used by the fixed rehearsal') } })
  const first = await authoring.proposeCompiled(source, revisionOne, samples, policyId)
  const duplicate = await authoring.proposeCompiled(source, revisionOne, samples, policyId)
  const second = await authoring.proposeCompiled(source, revisionTwo, samples, policyId)
  if (!first.simulation.safeToActivate || !second.simulation.safeToActivate) throw new Error('synthetic policy failed its safety simulation')
  if (first.revision !== duplicate.revision || second.revision !== first.revision + 1) throw new Error('policy revision idempotency failed')
  await authoring.activate(policyId, second.revision, true)
  const activated = (await store.policies(10))[0]
  await authoring.rollback(policyId, first.revision, true)
  const rolledBack = (await store.policies(10))[0]
  process.stdout.write(`${JSON.stringify({
    ok: true,
    syntheticOnly: true,
    policyId,
    revisions: [first.revision, second.revision],
    duplicateReusedRevision: duplicate.revision === first.revision,
    sampleCount: first.simulation.sampleCount,
    matchedCount: first.simulation.matchedCount,
    urgentSuppressedCount: first.simulation.urgentSuppressedCount,
    activatedRevision: activated?.revision,
    rolledBackRevision: rolledBack?.revision,
    externalWrites: 0,
    rawBusinessContentEmitted: false,
  }, null, 2)}\n`)
} finally {
  await store.close()
  await rm(directory, { recursive: true, force: true })
}
