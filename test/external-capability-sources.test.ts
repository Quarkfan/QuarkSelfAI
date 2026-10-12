import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('external source catalog keeps Monid inactive, bounded, and subordinate to dedicated tools', async () => {
  const catalog = JSON.parse(await readFile(new URL('../config/external-capability-sources.json', import.meta.url), 'utf8'))
  assert.equal(catalog.schemaVersion, 1)
  const source = catalog.sources.find((item: { id: string }) => item.id === 'monid')
  assert.ok(source)
  assert.equal(source.state, 'catalogued-inactive')
  assert.equal(source.routing, 'gap-only-after-dedicated-tool')
  assert.equal(source.requiresEndpointAllowlist, true)
  assert.equal(source.requiresExplicitCostApproval, true)
  assert.equal(source.requiresExplicitExternalEffectApproval, true)
  for (const flag of ['activationAllowed', 'installationAllowed', 'credentialConfigured', 'liveCallsAllowed']) {
    assert.equal(source[flag], false, `${flag} must fail closed`)
  }
  assert.ok(source.blockers.length > 0)
  assert.ok(Date.parse(source.reviewBy) > Date.parse(source.observedAt))
  await readFile(new URL(`../${source.reference}`, import.meta.url))
})
