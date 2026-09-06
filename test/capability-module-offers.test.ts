import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileModuleCapabilityOffers } from '../src/capability-platform/module-offer-compiler.js'
import { validateModuleCatalog } from '../src/platform/modules.js'

const revision = '9691ed78d9e552a958cfc9f19ac7cfd358b02eb9'

async function fixtures() {
  const catalog = validateModuleCatalog(JSON.parse(await readFile(new URL('../config/module-catalog.json', import.meta.url), 'utf8')))
  const migration = JSON.parse(await readFile(new URL('../config/capability-platform-migration.json', import.meta.url), 'utf8'))
  return { catalog, migration }
}

test('creates exactly one inactive offer for every current module', async () => {
  const { catalog, migration } = await fixtures()
  const result = compileModuleCapabilityOffers(catalog, migration, revision)
  assert.equal(result.offers.length, catalog.modules.length)
  assert.equal(new Set(result.offers.map(item => item.moduleId)).size, catalog.modules.length)
  assert.deepEqual(result.unclassifiedModuleIds, [])
  assert.ok(result.offers.every(item => item.activationAllowed === false && item.currentOwnerPreserved === true))
})

test('does not leak private source paths and keeps migration exit criteria', async () => {
  const { catalog, migration } = await fixtures()
  const result = compileModuleCapabilityOffers(catalog, migration, revision)
  const privateOffers = result.offers.filter(item => item.availability === 'private-pack-inactive')
  assert.equal(privateOffers.length, 6)
  assert.ok(privateOffers.every(item => item.sourceReferences.length === 0))
  const migrationOffers = result.offers.filter(item => item.availability === 'migration-only')
  assert.equal(migrationOffers.length, 5)
  assert.ok(migrationOffers.every(item => item.exitCriteria))
})

test('fails closed on duplicate, missing, unknown or activation-enabled mappings', async () => {
  const { catalog, migration } = await fixtures()
  const duplicate = structuredClone(migration)
  duplicate.groups[1].moduleIds.push(duplicate.groups[0].moduleIds[0])
  assert.throws(() => compileModuleCapabilityOffers(catalog, duplicate, revision), /multiple capability offers/)
  const missing = structuredClone(migration)
  missing.groups[0].moduleIds.shift()
  assert.throws(() => compileModuleCapabilityOffers(catalog, missing, revision), /missing capability offers/)
  assert.throws(() => compileModuleCapabilityOffers(catalog, { ...migration, rules: { ...migration.rules, activationAllowed: true } }, revision), /not safe/)
})
