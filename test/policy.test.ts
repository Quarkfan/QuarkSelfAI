import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesPolicy, policyRequiresApproval, simulatePolicy, validatePolicy } from '../src/policy/engine.js'
import type { PolicyDocument, PolicySample } from '../src/policy/types.js'

const policy: PolicyDocument = {
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
  validatePolicy(policy)
  assert.equal(matchesPolicy(policy.when, samples[0]?.facts ?? {}), true)
  assert.equal(matchesPolicy(policy.when, samples[1]?.facts ?? {}), false)
  assert.deepEqual(simulatePolicy(policy, samples), {
    sampleCount: 2,
    matchedCount: 1,
    silentCount: 0,
    batchCount: 1,
    realtimeCount: 0,
    urgentSuppressedCount: 0,
    safeToActivate: true,
    matchedSampleIds: ['normal'],
  })
  assert.equal(policyRequiresApproval(policy), false)
})

test('blocks activation when a silence rule would suppress urgent samples', () => {
  const unsafe: PolicyDocument = {
    ...policy,
    effect: { attention: 'silent' },
    when: { fact: 'channel.chatType', op: 'eq', value: 'group' },
  }
  const simulation = simulatePolicy(unsafe, samples)
  assert.equal(simulation.urgentSuppressedCount, 1)
  assert.equal(simulation.safeToActivate, false)
  assert.equal(policyRequiresApproval(unsafe), true)
})

test('rejects unsupported facts instead of executing arbitrary expressions', () => {
  assert.throws(() => validatePolicy({
    ...policy,
    when: { fact: 'process.env.SECRET' as never, op: 'exists' },
  }), /unsupported policy fact/)
})
