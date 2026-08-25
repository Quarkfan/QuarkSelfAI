import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesPolicy, validatePolicy } from '../src/policy/engine.js'
import {
  assistantPolicyRequiresApproval,
  simulateAssistantPolicy,
  validateAssistantPolicy,
  type AssistantPolicyDocument,
} from '../src/collaboration/policy-model.js'
import { policyProposalId } from '../src/collaboration/policy-authoring.js'
import { PolicyAuthoringService } from '../src/collaboration/policy-authoring.js'
import type { PolicySample } from '../src/policy/types.js'
import type { AssistantStore } from '../src/storage/types.js'

const policy: AssistantPolicyDocument = {
  version: 1,
  name: '普通群消息进入汇总',
  description: '未明确提到我的内部群消息不实时提醒',
  priority: 100,
  when: {
    all: [
      { fact: 'channel.chatType', op: 'eq', value: 'group' },
      { fact: 'channel.external', op: 'eq', value: false },
      { fact: 'message.mentionsOwner', op: 'eq', value: false },
    ],
  },
  effect: { attention: 'batch', settleMinutes: 10, addTags: ['自动汇总'] },
}

const samples: PolicySample[] = [
  { id: 'normal', facts: { channel: { chatType: 'group', external: false }, message: { mentionsOwner: false }, urgency: 'normal' } },
  { id: 'mention', facts: { channel: { chatType: 'group', external: false }, message: { mentionsOwner: true }, urgency: 'urgent' } },
]

test('evaluates a deterministic compiled policy', () => {
  validateAssistantPolicy(policy)
  assert.equal(matchesPolicy(policy.when, samples[0]?.facts ?? {}), true)
  assert.equal(matchesPolicy(policy.when, samples[1]?.facts ?? {}), false)
  assert.deepEqual(simulateAssistantPolicy(policy, samples), {
    sampleCount: 2,
    matchedCount: 1,
    silentCount: 0,
    batchCount: 1,
    realtimeCount: 0,
    urgentSuppressedCount: 0,
    coverageSufficient: false,
    safeToActivate: false,
    matchedSampleIds: ['normal'],
  })
  assert.equal(assistantPolicyRequiresApproval(policy), true)
})

test('the policy skeleton accepts a different product fact and effect through its schema port', () => {
  const document = {
    version: 1 as const,
    name: 'calendar product policy',
    description: 'proves the kernel does not enumerate assistant message vocabulary',
    priority: 10,
    when: { fact: 'calendar.attendeeCount', op: 'gte' as const, value: 8 },
    effect: { preparation: 'briefing' },
  }
  validatePolicy(document, {
    facts: new Set(['calendar.attendeeCount']),
    validateEffect(effect) {
      assert.equal((effect as { preparation?: unknown }).preparation, 'briefing')
    },
  })
  assert.equal(matchesPolicy(document.when, { calendar: { attendeeCount: 10 } }), true)
})

test('blocks activation when a silence rule would suppress urgent samples', () => {
  const unsafe: AssistantPolicyDocument = {
    ...policy,
    effect: { attention: 'silent' },
    when: { fact: 'channel.chatType', op: 'eq', value: 'group' },
  }
  const simulation = simulateAssistantPolicy(unsafe, samples)
  assert.equal(simulation.urgentSuppressedCount, 1)
  assert.equal(simulation.coverageSufficient, false)
  assert.equal(simulation.safeToActivate, false)
  assert.equal(assistantPolicyRequiresApproval(unsafe), true)
})

test('allows a noise-reduction draft only when local sample coverage is sufficient', () => {
  const covered = Array.from({ length: 20 }, (_, index): PolicySample => ({
    id: `sample-${index}`,
    facts: { channel: { chatType: 'group', external: false }, message: { mentionsOwner: false }, urgency: 'normal' },
  }))
  const simulation = simulateAssistantPolicy(policy, covered)
  assert.equal(simulation.coverageSufficient, true)
  assert.equal(simulation.safeToActivate, true)
})

test('rejects unsupported facts instead of executing arbitrary expressions', () => {
  assert.throws(() => validateAssistantPolicy({
    ...policy,
    when: { fact: 'process.env.SECRET' as never, op: 'exists' },
  }), /unsupported policy fact/)
})

test('uses a stable proposal id regardless of document property order', () => {
  const reordered = {
    effect: policy.effect,
    when: policy.when,
    priority: policy.priority,
    description: policy.description,
    name: policy.name,
    version: 1 as const,
  }
  assert.equal(policyProposalId('  降低干扰  ', policy), policyProposalId('降低干扰', reordered))
})

test('requires explicit owner confirmation for both activation and rollback', async () => {
  const activated: number[] = []
  const store = { async activatePolicy(_id: string, revision: number) { activated.push(revision) } } as AssistantStore
  const authoring = new PolicyAuthoringService(store, { async compile() { throw new Error('not used') } })
  await assert.rejects(authoring.activate('policy', 2, false), /explicit owner confirmation/)
  await authoring.activate('policy', 2, true)
  await assert.rejects(authoring.rollback('policy', 1, false), /explicit owner confirmation/)
  await authoring.rollback('policy', 1, true)
  assert.deepEqual(activated, [2, 1])
})
