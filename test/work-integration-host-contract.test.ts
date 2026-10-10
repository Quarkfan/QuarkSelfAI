import assert from 'node:assert/strict'
import test from 'node:test'
import { auditWorkIntegrationHostContract } from '../scripts/audit-work-integration-host-contract.js'

test('mounts one generic empty registry without an activation surface', async () => {
  const result = await auditWorkIntegrationHostContract()
  assert.equal(result.ok, true)
  assert.equal(result.packBindingCount, 0)
  assert.equal(result.consumers, 0)
  assert.equal(result.activeProviders, 0)
  assert.equal(result.schedulers, 0)
  assert.equal(result.externalWriters, 0)
  assert.equal(result.activationAvailable, false)
})
