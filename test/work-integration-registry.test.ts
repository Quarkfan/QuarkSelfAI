import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkIntegrationRegistryV1 } from '../src/work-integration/registry.js'

test('registers only an inactive pack and exposes no activation surface', () => {
  const registry = new WorkIntegrationRegistryV1()
  const manifest = packManifest()
  const registration = { schemaVersion: 1, packId: manifest.packId, packVersion: manifest.packVersion, contractVersion: '1.0.0', contributions: manifest.contributions }
  assert.equal(registry.registerInactive(manifest, registration).state, 'registered-inactive')
  assert.deepEqual(registry.snapshot(), {
    contractVersion: '1.0.0', packs: [{ packId: 'example-private-pack', packVersion: '1.0.0', sourceRevision: 'b'.repeat(40), contributionCount: 1, state: 'registered-inactive' }],
    consumers: 0, activeProviders: 0, schedulers: 0, externalWriters: 0, activationAvailable: false,
  })
  assert.equal('activate' in registry, false)
  assert.throws(() => registry.registerInactive(manifest, registration), /already registered/)
})

test('fails closed before registering a duplicate exclusive owner', () => {
  const registry = new WorkIntegrationRegistryV1()
  const first = packManifest()
  registry.registerInactive(first, { schemaVersion: 1, packId: first.packId, packVersion: first.packVersion, contractVersion: '1.0.0', contributions: first.contributions })
  const second = { ...packManifest(), packId: 'other-private-pack', recovery: { stateNamespace: 'other-private-pack', restoreEffectsEnabled: false } }
  assert.throws(() => registry.registerInactive(second, { schemaVersion: 1, packId: second.packId, packVersion: second.packVersion, contractVersion: '1.0.0', contributions: second.contributions }), /exclusive ownership already registered/)
  assert.equal(registry.snapshot().packs.length, 1)
})

function packManifest() {
  return {
    schemaVersion: 1, packId: 'example-private-pack', packVersion: '1.0.0',
    source: { revision: 'b'.repeat(40), artifactDigest: `sha256:${'a'.repeat(64)}` }, contract: { version: '1.0.0' },
    contributions: [{ id: 'example.context', version: '1.0.0', kind: 'context-enricher', ownershipKey: 'example.context', ownershipSemantics: 'exclusive', effectMode: 'none' }],
    requiredHostCapabilities: ['message.read', 'approval.verify'], dataClasses: ['work-metadata'],
    recovery: { stateNamespace: 'example-private-pack', restoreEffectsEnabled: false },
  }
}
