import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeEffectCoverage, loadModuleCatalog, summarizeModules, validateModuleCatalog, validateSourceOwnership } from '../src/platform/modules.js'

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
      { id: 'feature-a', classification: 'feature', layer: 'workflow', status: 'native', source: 'a', owns: [], dependsOn: [] },
      { id: 'skeleton-a', classification: 'skeleton', layer: 'kernel', status: 'native', source: 'b', owns: [], dependsOn: ['feature-a'] },
    ],
  }), /skeleton module skeleton-a cannot depend on feature module feature-a/)
})

test('prevents feature code from acquiring a migration dependency', () => {
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'migration-a', classification: 'migration', layer: 'operations', status: 'native', source: 'a', owns: [], dependsOn: [], exitCriteria: 'remove it' },
      { id: 'feature-a', classification: 'feature', layer: 'workflow', status: 'native', source: 'b', owns: [], dependsOn: ['migration-a'] },
    ],
  }), /feature module feature-a cannot depend on migration module migration-a/)
})

test('rejects dependency cycles and compat features without a migration host', () => {
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'feature-a', classification: 'feature', layer: 'workflow', status: 'compat', source: 'a', owns: [], hostedBy: 'missing', dependsOn: [] },
    ],
  }), /must name a migration host/)
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'a', classification: 'feature', layer: 'workflow', status: 'native', source: 'a', owns: [], dependsOn: ['b'] },
      { id: 'b', classification: 'feature', layer: 'workflow', status: 'native', source: 'b', owns: [], dependsOn: ['a'] },
    ],
  }), /module dependency cycle/)
})

test('requires every source file to have exactly one explicit module owner', () => {
  const catalog = validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'contracts', classification: 'skeleton', layer: 'contract', status: 'native', source: 'src/domain/contracts.ts', owns: ['src/domain/contracts.ts'], dependsOn: [] },
    ],
  })
  assert.doesNotThrow(() => validateSourceOwnership(catalog, ['src/domain/contracts.ts']))
  assert.throws(() => validateSourceOwnership(catalog, ['src/domain/contracts.ts', 'src/domain/new-contract.ts']), /unowned source: src\/domain\/new-contract.ts/)
  assert.throws(() => validateSourceOwnership(catalog, []), /owned source does not exist: src\/domain\/contracts.ts/)
})

test('rejects duplicate ownership and src entrypoints that are not owned', () => {
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'a', classification: 'skeleton', layer: 'contract', status: 'native', source: 'src/domain/a.ts', owns: ['src/domain/a.ts'], dependsOn: [] },
      { id: 'b', classification: 'skeleton', layer: 'contract', status: 'native', source: 'src/domain/b.ts', owns: ['src/domain/a.ts', 'src/domain/b.ts'], dependsOn: [] },
    ],
  }), /source src\/domain\/a.ts is owned by both a and b/)
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'a', classification: 'skeleton', layer: 'contract', status: 'native', source: 'src/domain/a.ts', owns: [], dependsOn: [] },
    ],
  }), /must own its src entrypoint/)
})

test('reports planned effect gaps and blocks native consumers without a provider', () => {
  const planned = validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'workflow', classification: 'feature', layer: 'workflow', status: 'planned', source: 'workflow', owns: [], dependsOn: [], requiresEffects: ['task-system.read.v1'] },
    ],
  })
  assert.deepEqual(analyzeEffectCoverage(planned), { required: ['task-system.read.v1'], declared: [], provided: [], missing: ['task-system.read.v1'] })
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'workflow', classification: 'feature', layer: 'workflow', status: 'native', source: 'workflow', owns: [], dependsOn: [], requiresEffects: ['task-system.read.v1'] },
    ],
  }), /native module workflow requires non-native effect task-system\.read\.v1/)
})

test('requires each effect to have only one provider', () => {
  assert.throws(() => validateModuleCatalog({
    version: 1,
    modules: [
      { id: 'a', classification: 'feature', layer: 'adapter', status: 'planned', source: 'a', owns: [], dependsOn: [], providesEffects: ['task-system.read.v1'] },
      { id: 'b', classification: 'feature', layer: 'adapter', status: 'planned', source: 'b', owns: [], dependsOn: [], providesEffects: ['task-system.read.v1'] },
    ],
  }), /effect task-system\.read\.v1 is provided by both a and b/)
})
