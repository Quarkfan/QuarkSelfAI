import test from 'node:test'
import assert from 'node:assert/strict'
import { CollaborationLearningEngine, classifyAttention, type CollaborationLearningPort } from '../src/collaboration/engine.js'
import type { CollaborationPolicyProposal } from '../src/collaboration/types.js'
import type { DurableSignal, DurableSignalInput, PolicyDraftInput } from '../src/storage/types.js'
import type { PolicySample } from '../src/policy/types.js'

class MemoryPort implements CollaborationLearningPort {
  readonly signals: DurableSignal[] = []
  readonly checkpoints = new Map<string, Readonly<Record<string, unknown>>>()
  readonly proposals: CollaborationPolicyProposal[] = []
  readonly drafts: PolicyDraftInput[] = []
  policySamples: readonly PolicySample[] = Array.from({ length: 20 }, (_, index) => ({
    id: `event-${index}`,
    facts: { source: { chatId: 'oc_repeated', senderId: 'ou_sender' } },
  }))
  publishError: Error | undefined

  async appendSignal(input: DurableSignalInput) {
    const existing = this.signals.find(signal => signal.id === input.id)
    if (existing) return { inserted: false }
    this.signals.push({ ...input, scope: input.scope ?? {}, recordedAt: input.occurredAt })
    return { inserted: true }
  }

  async recentSignals(kind: string, limit: number) {
    return this.signals.filter(signal => signal.kind === kind).slice(-limit).reverse()
  }

  async readCheckpoint(namespace: string, key: string) {
    return this.checkpoints.get(`${namespace}:${key}`)
  }

  async writeCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>) {
    this.checkpoints.set(`${namespace}:${key}`, value)
  }

  async recentPolicySamples(limit: number): Promise<readonly PolicySample[]> {
    return this.policySamples.slice(0, limit)
  }

  async savePolicyDraft(input: PolicyDraftInput) {
    this.drafts.push(input)
    return 1
  }

  async publishProposal(proposal: CollaborationPolicyProposal) {
    if (this.publishError) throw this.publishError
    this.proposals.push(proposal)
  }
}

function message(index: number) {
  return { messageId: `om_${index}`, chatId: 'oc_repeated', senderId: 'ou_sender', intakeReasons: ['飞书标记会话'] }
}

const ordinaryTask = {
  taskAction: 'updated' as const,
  notificationDecision: 'notify' as const,
  priority: 1,
  actionRequired: false,
  actionOwner: 'other' as const,
  researchDecision: 'skip' as const,
  materialChangeSummary: '普通进展',
}

test('native attention classification preserves protected urgency semantics', () => {
  assert.equal(classifyAttention({ priority: 5 }), 'realtime')
  assert.equal(classifyAttention({ actionRequired: true, actionOwner: 'changdongxu' }), 'today')
  assert.equal(classifyAttention({ priority: 1 }), 'silent')
})

test('native observations are idempotent and omit message content', async () => {
  const port = new MemoryPort()
  const engine = new CollaborationLearningEngine(port)
  assert.equal(await engine.observe(message(1), ordinaryTask, new Date('2026-08-23T00:00:00Z')), true)
  assert.equal(await engine.observe(message(1), ordinaryTask, new Date('2026-08-23T00:00:00Z')), false)
  assert.equal(port.signals.length, 1)
  assert.equal('content' in port.signals[0]!.data, false)
  assert.equal(port.signals[0]!.data.difference, 'could_batch')
})

test('native learning creates a durable draft and emits one proposal after safe evidence', async () => {
  const port = new MemoryPort()
  const engine = new CollaborationLearningEngine(port, { evaluationIntervalMs: 0 })
  for (let index = 0; index < 20; index += 1) {
    await engine.observe(message(index), ordinaryTask, new Date(`2026-08-23T00:${String(index).padStart(2, '0')}:00Z`))
  }
  const proposal = await engine.poll(new Date('2026-08-24T00:00:00Z'))
  assert.equal(proposal?.simulation.safeToActivate, true)
  assert.deepEqual(proposal?.document.when, { fact: 'source.chatId', op: 'eq', value: 'oc_repeated' })
  assert.equal(port.drafts.length, 1)
  assert.equal(port.proposals.length, 1)
  assert.equal(await engine.poll(new Date('2026-08-25T00:00:00Z')), undefined)
})

test('native learning does not propose when a scope contains protected evidence', async () => {
  const port = new MemoryPort()
  const engine = new CollaborationLearningEngine(port, { evaluationIntervalMs: 0 })
  for (let index = 0; index < 20; index += 1) {
    await engine.observe(message(index), index === 19 ? { ...ordinaryTask, approvalRequired: true } : ordinaryTask)
  }
  assert.equal(await engine.poll(new Date('2026-08-24T00:00:00Z')), undefined)
  assert.equal(port.drafts.length, 0)
})

test('native learning retains an unsafe draft but never publishes it for approval', async () => {
  const port = new MemoryPort()
  port.policySamples = port.policySamples.map((sample, index) => index === 0
    ? { ...sample, facts: { ...sample.facts, urgency: 'urgent' } }
    : sample)
  const engine = new CollaborationLearningEngine(port, { evaluationIntervalMs: 0 })
  for (let index = 0; index < 20; index += 1) await engine.observe(message(index), ordinaryTask)
  assert.equal(await engine.poll(new Date('2026-08-24T00:00:00Z')), undefined)
  assert.equal(port.drafts.length, 1)
  assert.equal(port.proposals.length, 0)
})

test('failed proposal projection does not advance the evaluation checkpoint', async () => {
  const port = new MemoryPort()
  const engine = new CollaborationLearningEngine(port, { evaluationIntervalMs: 86_400_000 })
  for (let index = 0; index < 20; index += 1) await engine.observe(message(index), ordinaryTask)
  port.publishError = new Error('approval workflow unavailable')
  await assert.rejects(engine.poll(new Date('2026-08-24T00:00:00Z')), /approval workflow unavailable/)
  assert.equal(port.checkpoints.has('collaboration-learning:evaluation'), false)
  port.publishError = undefined
  assert.ok(await engine.poll(new Date('2026-08-24T00:01:00Z')))
})

test('native guidance uses interaction metadata without retaining conversation text', async () => {
  const port = new MemoryPort()
  const engine = new CollaborationLearningEngine(port)
  const signal = { type: 'reaction', operation: 'created', emojiType: 'THUMBSUP', ownerOperated: true }
  await engine.observe({ ...message(1), signal }, { ...ordinaryTask, taskAction: 'created', actionOwner: 'changdongxu' })
  await engine.observe({ ...message(2), signal }, { ...ordinaryTask, taskAction: 'ignored', notificationDecision: 'silent' })
  const guidance = await engine.guidanceFor({ ...message(3), signal })
  assert.match(guidance, /同类脱敏样本 2 条/)
  assert.match(guidance, /建单 1、更新 0、忽略 1/)
})
