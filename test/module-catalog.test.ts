import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModuleCatalog, summarizeModules, validateModuleCatalog } from '../src/platform/modules.js'

test('classifies every current module as skeleton, feature, or migration', async () => {
  const catalog = await loadModuleCatalog()
  const summary = summarizeModules(catalog)
  assert.ok(summary.skeleton.native >= 10)
  assert.ok(summary.feature.native >= 4)
  assert.ok(summary.feature.compat >= 8)
  assert.ok(summary.migration.native >= 3)
  assert.equal(catalog.modules.some(module => module.classification === 'migration' && !module.exitCriteria), false)
})

test('prevents the skeleton from depending on a feature', () => {
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'feature-a', classification: 'feature', layer: 'workflow', status: 'native', source: 'a', dependsOn: [] },
      { id: 'skeleton-a', classification: 'skeleton', layer: 'kernel', status: 'native', source: 'b', dependsOn: ['feature-a'] },
    ],
  }), /skeleton module skeleton-a cannot depend on feature module feature-a/)
})

test('prevents feature code from acquiring a migration dependency', () => {
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'migration-a', classification: 'migration', layer: 'operations', status: 'native', source: 'a', dependsOn: [], exitCriteria: 'remove it' },
      { id: 'feature-a', classification: 'feature', layer: 'workflow', status: 'native', source: 'b', dependsOn: ['migration-a'] },
    ],
  }), /feature module feature-a cannot depend on migration module migration-a/)
})

test('rejects dependency cycles and compat features without a migration host', () => {
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'feature-a', classification: 'feature', layer: 'workflow', status: 'compat', source: 'a', hostedBy: 'missing', dependsOn: [] },
    ],
  }), /must name a migration host/)
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'a', classification: 'feature', layer: 'workflow', status: 'native', source: 'a', dependsOn: ['b'] },
      { id: 'b', classification: 'feature', layer: 'workflow', status: 'native', source: 'b', dependsOn: ['a'] },
    ],
  }), /module dependency cycle/)
})
