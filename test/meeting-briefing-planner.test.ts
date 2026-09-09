import assert from 'node:assert/strict'
import test from 'node:test'
import { planInactiveMeetingBriefing } from '../src/meeting-briefing/planner.js'

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
