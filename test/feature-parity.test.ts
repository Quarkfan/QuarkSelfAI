import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateTakeoverRiskAcceptance, loadFeatureParity, loadNativeCutoverReadiness, type FeatureParityReport,
} from '../src/config/feature-parity.js'

const report: FeatureParityReport = {
  source: 'test',
  takeoverReady: false,
  missingRequired: 2,
  completed: 1,
  nativeCutoverReady: false,
  nativeCutoverBlockers: ['focus-intake'],
  features: [
    { id: 'complete', name: 'complete', requiredForTakeover: true, status: 'complete', evidence: 'test' },
    { id: 'dida-projection', name: 'dida', requiredForTakeover: true, status: 'partial', evidence: 'test' },
    { id: 'shadow-collaboration', name: 'shadow', requiredForTakeover: true, status: 'partial', evidence: 'test' },
  ],
}

test('allows only an exact owner-accepted set of known incomplete takeover risks', () => {
  const result = evaluateTakeoverRiskAcceptance(
    report,
    true,
    'shadow-collaboration,dida-projection',
  )
  assert.equal(result.ready, true)
  assert.equal(result.acceptedRiskCutover, true)
  assert.deepEqual(result.unacceptedIncomplete, [])
  assert.deepEqual(result.unknownAccepted, [])
})

test('keeps functional parity separate from native module ownership', async () => {
  const current = await loadFeatureParity()
  assert.equal(current.nativeCutoverReady, false)
  assert.ok(current.nativeCutoverBlockers.includes('message-intake-native'))
  assert.ok(current.nativeCutoverBlockers.includes('focus-intake'))
  assert.equal(current.nativeCutoverBlockers.includes('postgres-storage'), false)
  assert.equal(current.nativeCutoverBlockers.includes('message-projection-contracts'), false)
  assert.equal(current.nativeCutoverBlockers.includes('agent-bound-action-worker'), true)
})

test('adapts migration parity into the open operational readiness contract', async () => {
  const readiness = await loadNativeCutoverReadiness()
  assert.equal(readiness.id, 'native-cutover')
  assert.equal(readiness.state, 'blocked')
  assert.ok(readiness.items.length > 0)
  assert.ok(readiness.blockers.includes('message-intake-native'))
  assert.equal(typeof readiness.summary.functionalParityReady, 'boolean')
})

test('fails closed for missing confirmation, omitted risks, and unknown risk ids', () => {
  assert.equal(evaluateTakeoverRiskAcceptance(report, false, 'dida-projection,shadow-collaboration').ready, false)
  assert.deepEqual(evaluateTakeoverRiskAcceptance(report, true, 'dida-projection').unacceptedIncomplete, ['shadow-collaboration'])
  assert.deepEqual(
    evaluateTakeoverRiskAcceptance(report, true, 'dida-projection,shadow-collaboration,new-risk').unknownAccepted,
    ['new-risk'],
  )
})
