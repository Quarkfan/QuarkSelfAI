import assert from 'node:assert/strict'
import test from 'node:test'
import { auditAssistantContinuity, instructionMirrorDigest } from '../scripts/audit-assistant-continuity.js'

test('maps assistant behavior to portable sources without claiming organization is complete', async () => {
  const report = await auditAssistantContinuity(process.cwd())
  assert.equal(report.ok, true)
  assert.equal(report.organizationComplete, false)
  assert.equal(report.instructionContract.tracked, true)
  assert.equal(report.instructionContract.mirrored, true)
  assert.equal(report.instructionContract.sourceCount, 2)
  assert.ok(report.durableCapabilityCount >= 4)
  assert.ok(report.outstanding.includes('private-work-integration-remote'))
  assert.equal(report.outstanding.includes('personal-portable-assets-curation'), false)
  assert.equal(report.personalCapabilityCuration.status, 'decision-complete')
  assert.equal(report.personalCapabilityCuration.selectedPortableAssetCount, 0)
  assert.equal(report.privacy.fileContentsIncluded, false)
})

test('fails closed when the executor instruction mirrors drift', async () => {
  assert.equal(instructionMirrorDigest(['same', 'same']).mirrored, true)
  assert.equal(instructionMirrorDigest(['codex', 'claude']).mirrored, false)
})
