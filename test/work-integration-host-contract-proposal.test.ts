import assert from 'node:assert/strict'
import test from 'node:test'
import { auditWorkIntegrationHostContractProposal } from '../scripts/audit-work-integration-host-contract-proposal.js'

test('keeps phase 2 machine-pinned, inactive, and independent from the private pack', async () => {
  const result = await auditWorkIntegrationHostContractProposal()
  assert.equal(result.ok, true)
  assert.equal(result.status, 'awaiting-owner-approval')
  assert.equal(result.baseRevisionCount, 2)
  assert.equal(result.activationApprovedCount, 0)
  assert.deepEqual(result.privacy, {
    fileContentsIncluded: false,
    credentialValuesIncluded: false,
    businessMessagesIncluded: false,
  })
})
