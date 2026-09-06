import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { PlatformFacilitySpecV1 } from '../src/capability-platform/facilities.js'
import { compilePlatformFacilities } from '../src/capability-platform/facility-compiler.js'
import { compileModuleCapabilityOffers } from '../src/capability-platform/module-offer-compiler.js'
import { validateModuleCatalog } from '../src/platform/modules.js'

const revision = '60fcba89430dbd32d7756cc6506cb777614d2cb8'

async function fixtures() {
  const catalog = validateModuleCatalog(JSON.parse(await readFile(new URL('../config/module-catalog.json', import.meta.url), 'utf8')))
  const migration = JSON.parse(await readFile(new URL('../config/capability-platform-migration.json', import.meta.url), 'utf8'))
  const specs = JSON.parse(await readFile(new URL('../config/platform-facilities.json', import.meta.url), 'utf8')).facilities as PlatformFacilitySpecV1[]
  return { offers: compileModuleCapabilityOffers(catalog, migration, revision), specs }
}

test('represents every core-bound offer exactly once as a non-installable platform facility', async () => {
  const { offers, specs } = await fixtures()
  const catalog = compilePlatformFacilities(offers, specs)
  assert.equal(catalog.coveredCoreOfferCount, 64)
  assert.deepEqual(catalog.uncoveredModuleIds, [])
  assert.equal(catalog.facilities.length, 4)
  assert.ok(catalog.facilities.every(item => !item.installable && !item.replaceableByPrivatePack && item.currentOwnerPreserved))
})

test('does not let private packs replace core or let a core plane disappear', async () => {
  const { offers, specs } = await fixtures()
  assert.throws(() => compilePlatformFacilities(offers, specs.slice(1)), /missing platform facilities/)
  assert.throws(() => compilePlatformFacilities(offers, [{ ...specs[0], replaceableByPrivatePack: true }, ...specs.slice(1)]), /private-replaceable/)
  assert.throws(() => compilePlatformFacilities(offers, [...specs, { ...specs[0], id: 'duplicate-plane' }]), /multiple platform facilities/)
})
