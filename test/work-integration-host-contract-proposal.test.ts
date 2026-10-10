import assert from 'node:assert/strict'
import test from 'node:test'
import { auditWorkIntegrationHostContractProposal } from '../scripts/audit-work-integration-host-contract-proposal.js'

test('records the approved phase 2 implementation while keeping runtime activation excluded', async () => {
  const result = await auditWorkIntegrationHostContractProposal()
  assert.equal(result.ok, true)
  assert.equal(result.status, 'implementation-approved-in-progress')
  assert.equal(result.baseRevisionCount, 2)
  assert.equal(result.activationApprovedCount, 1)
  assert.deepEqual(result.privacy, {
    fileContentsIncluded: false,
    credentialValuesIncluded: false,
    businessMessagesIncluded: false,
  })
})
