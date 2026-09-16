import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateInactiveMeetingBriefingPilot, planInactiveMeetingBriefing } from '../src/meeting-briefing/planner.js'

function fixture() {
  return {
    mode: 'inactive-shadow' as const,
    now: '2026-09-09T01:00:00.000Z',
    eventId: 'event-private-1',
    eventRevision: 'revision-1',
    startsAt: '2026-09-09T03:00:00.000Z',
    attendance: 'accepted' as const,
    directResponsibility: true,
    sources: [
      { kind: 'calendar' as const, status: 'available' as const, itemCount: 1 },
      { kind: 'dida' as const, status: 'available' as const, itemCount: 2 },
      { kind: 'feishu' as const, status: 'partial' as const, itemCount: 24 },
    ],
  }
}

test('creates only a privacy-bounded inactive shadow plan for a responsible upcoming meeting', () => {
  const plan = planInactiveMeetingBriefing(fixture())
  assert.equal(plan.outcome, 'shadow-draft')
  assert.equal(plan.briefDueAt, '2026-09-09T02:00:00.000Z')
  assert.match(plan.idempotencyKey ?? '', /^meeting-briefing\.v1\.[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(plan).includes('event-private-1'), false)
  assert.equal(plan.sourceSummary.find(source => source.kind === 'feishu')?.itemCount, 20)
  assert.deepEqual(plan.boundary, { runtimeActive: false, sourceReadsExecuted: false, rawContentStored: false, externalEffectsEnabled: false, ownerNotificationAllowed: false })
})

test('skips meetings without direct owner responsibility or bounded contextual evidence', () => {
  const plan = planInactiveMeetingBriefing({
    ...fixture(),
    attendance: 'accepted',
    directResponsibility: false,
    sources: [{ kind: 'calendar', status: 'available', itemCount: 1 }],
  })
  assert.equal(plan.outcome, 'skip')
  assert.ok(plan.reasons.includes('no-direct-responsibility'))
  assert.ok(plan.reasons.includes('insufficient-bounded-context'))
})

test('changes the opaque idempotency key when the event revision changes', () => {
  const first = planInactiveMeetingBriefing(fixture())
  const second = planInactiveMeetingBriefing({ ...fixture(), eventRevision: 'revision-2' })
  assert.notEqual(first.idempotencyKey, second.idempotencyKey)
})

test('rejects activation-shaped or raw-content-shaped input before planning', () => {
  assert.throws(() => planInactiveMeetingBriefing({ ...fixture(), mode: 'active' }), /must remain inactive-shadow/)
  assert.throws(() => planInactiveMeetingBriefing({ ...fixture(), messageBody: 'raw context' }), /unsupported fields/)
  assert.throws(() => planInactiveMeetingBriefing({ ...fixture(), sources: [...fixture().sources, fixture().sources[0]] }), /duplicate kinds/)
})

function pilotEvidence() {
  return {
    mode: 'inactive-shadow-evaluation' as const,
    workingDaysElapsed: 7,
    eligibleMeetings: 8,
    draftsCreated: 7,
    reviewedDrafts: 7,
    materiallyUsefulDrafts: 5,
    lowValueOrMisleadingDrafts: 2,
    violations: { privacy: 0, sourceScope: 0, deduplication: 0, externalEffect: 0 },
  }
}

test('passes the inactive pilot only when both declared success thresholds are met', () => {
  const decision = evaluateInactiveMeetingBriefingPilot(pilotEvidence())
  assert.equal(decision.outcome, 'pass')
  assert.deepEqual(decision.reasons, ['shadow-pilot-thresholds-met'])
  assert.equal(decision.rates.draftCoverage, 7 / 8)
  assert.equal(decision.rates.materiallyUseful, 5 / 7)
  assert.deepEqual(decision.boundary, { rawContentAccepted: false, sourceReadsExecuted: false, externalEffectsEnabled: false })
})

test('continues before the bounded exit condition and fails when evidence is insufficient', () => {
  assert.equal(evaluateInactiveMeetingBriefingPilot({ ...pilotEvidence(), workingDaysElapsed: 5, eligibleMeetings: 4, draftsCreated: 4, reviewedDrafts: 4, materiallyUsefulDrafts: 3, lowValueOrMisleadingDrafts: 1 }).outcome, 'continue')
  const insufficient = evaluateInactiveMeetingBriefingPilot({ ...pilotEvidence(), workingDaysElapsed: 10, eligibleMeetings: 7, draftsCreated: 7, reviewedDrafts: 7, materiallyUsefulDrafts: 5, lowValueOrMisleadingDrafts: 2 })
  assert.equal(insufficient.outcome, 'fail')
  assert.ok(insufficient.reasons.includes('insufficient-eligible-meetings-within-10-working-days'))
})

test('fails closed on any safety violation or low-value rate above 30 percent', () => {
  const violation = evaluateInactiveMeetingBriefingPilot({ ...pilotEvidence(), violations: { ...pilotEvidence().violations, sourceScope: 1 } })
  assert.deepEqual(violation.reasons, ['safety-boundary-violation'])
  const lowValue = evaluateInactiveMeetingBriefingPilot({ ...pilotEvidence(), lowValueOrMisleadingDrafts: 3, materiallyUsefulDrafts: 4 })
  assert.deepEqual(lowValue.reasons, ['low-value-or-misleading-rate-above-30-percent'])
})

test('rejects raw-content-shaped, overlapping or inconsistent evaluation evidence', () => {
  assert.throws(() => evaluateInactiveMeetingBriefingPilot({ ...pilotEvidence(), draftBody: 'raw content' }), /unsupported fields/)
  assert.throws(() => evaluateInactiveMeetingBriefingPilot({ ...pilotEvidence(), draftsCreated: 9 }), /drafts created is invalid/)
  assert.throws(() => evaluateInactiveMeetingBriefingPilot({ ...pilotEvidence(), materiallyUsefulDrafts: 6, lowValueOrMisleadingDrafts: 2 }), /review classifications overlap/)
})
