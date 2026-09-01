import assert from 'node:assert/strict'
import test from 'node:test'
import { assessSkillPromotion, type SkillPromotionInput } from '../src/skill-evolution/compiler.js'

function fixture(): SkillPromotionInput {
  return {
    now: '2026-09-01T08:00:00.000Z',
    policy: {
      minDistinctTasksPerPattern: 2,
      minSamplesPerExecutor: 20,
      minScoreDelta: 0.05,
      maxScoreRegression: 0,
      minTriggerPrecision: 0.9,
      minTriggerRecall: 0.8,
    },
    candidate: {
      id: 'candidate-1',
      name: 'context-aware-followup',
      description: 'Use bounded context and evidence before proposing a follow-up.',
      purpose: 'Reduce late and duplicate task creation.',
      patternIds: ['late-followup'],
      targetExecutors: ['claude-code', 'codex', 'dsh-native'],
      state: 'shadow',
    },
    records: [
      { id: 'e1', taskFingerprint: 'task-a', observedAt: '2026-08-29T08:00:00.000Z', outcome: 'corrected', summary: 'Late item was already handled.', redaction: { redacted: true, rawContentStored: false, reasoningStored: false } },
      { id: 'e2', taskFingerprint: 'task-b', observedAt: '2026-08-30T08:00:00.000Z', outcome: 'success', summary: 'Recent context prevented a duplicate.', redaction: { redacted: true, rawContentStored: false, reasoningStored: false } },
    ],
    patterns: [{
      id: 'late-followup', title: 'Late follow-up', statement: 'Delayed messages can describe completed work.', remediation: 'Read bounded recent context before projecting a task.',
      evidenceIds: ['e1', 'e2'], counterEvidenceIds: [], status: 'current', validUntil: '2026-12-01T00:00:00.000Z',
    }],
    evaluations: ['claude-code', 'codex', 'dsh-native'].map(executor => ({
      executor: executor as 'claude-code' | 'codex' | 'dsh-native', sampleCount: 24, baselineScore: 0.7, candidateScore: 0.8,
      triggerPrecision: 0.95, triggerRecall: 0.9, safetyViolations: 0, approvalViolations: 0,
    })),
  }
}

test('allows a privacy-bounded, cross-executor candidate to proceed only to review', () => {
  assert.deepEqual(assessSkillPromotion(fixture()), {
    outcome: 'eligible-for-review',
    reasons: ['evidence, privacy, cross-executor evaluation, and regression gates passed'],
  })
})

test('rejects raw reasoning, safety violations, and cross-model negative transfer', () => {
  const input = fixture()
  const records = input.records.map((record, index) => index === 0 ? { ...record, redaction: { ...record.redaction, reasoningStored: true } } : record)
  const evaluations = input.evaluations.map(item => item.executor === 'dsh-native'
    ? { ...item, candidateScore: 0.5, safetyViolations: 1 }
    : item)
  const decision = assessSkillPromotion({ ...input, records, evaluations })
  assert.equal(decision.outcome, 'reject')
  assert.ok(decision.reasons.some(reason => reason.includes('privacy boundary')))
  assert.ok(decision.reasons.some(reason => reason.includes('safety violations')))
  assert.ok(decision.reasons.some(reason => reason.includes('regression budget')))
})

test('keeps incomplete evidence, stale knowledge, and missing executor coverage in shadow', () => {
  const input = fixture()
  const decision = assessSkillPromotion({
    ...input,
    patterns: input.patterns.map(pattern => ({ ...pattern, status: 'stale' as const, evidenceIds: ['e1'] })),
    evaluations: input.evaluations.filter(item => item.executor !== 'codex'),
  })
  assert.equal(decision.outcome, 'keep-shadow')
  assert.ok(decision.reasons.includes('pattern late-followup is stale'))
  assert.ok(decision.reasons.includes('missing evaluation for codex'))
})

test('counts distinct task fingerprints instead of repeated records', () => {
  const input = fixture()
  const records = input.records.map(record => ({ ...record, taskFingerprint: 'same-task' }))
  const decision = assessSkillPromotion({ ...input, records })
  assert.equal(decision.outcome, 'keep-shadow')
  assert.ok(decision.reasons.includes('pattern late-followup has only 1 distinct tasks'))
})

test('rejects ambiguous evidence that is also labeled as counter-evidence', () => {
  const input = fixture()
  const decision = assessSkillPromotion({
    ...input,
    patterns: input.patterns.map(pattern => ({ ...pattern, counterEvidenceIds: ['e2'] })),
  })
  assert.equal(decision.outcome, 'reject')
  assert.ok(decision.reasons.includes('pattern late-followup uses the same record as evidence and counter-evidence'))
})

test('keeps unresolved independent counter-evidence in shadow', () => {
  const input = fixture()
  const records = [...input.records, {
    id: 'e3', taskFingerprint: 'task-c', observedAt: '2026-08-31T08:00:00.000Z', outcome: 'failure' as const,
    summary: 'The candidate procedure did not apply.', redaction: { redacted: true, rawContentStored: false, reasoningStored: false },
  }]
  const decision = assessSkillPromotion({
    ...input,
    records,
    patterns: input.patterns.map(pattern => ({ ...pattern, counterEvidenceIds: ['e3'] })),
  })
  assert.equal(decision.outcome, 'keep-shadow')
  assert.ok(decision.reasons.includes('pattern late-followup has unresolved counter-evidence'))
})
