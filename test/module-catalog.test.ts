import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeEffectCoverage, loadModuleCatalog, summarizeModules, validateAssetOwnership, validateModuleCatalog, validateSourceOwnership } from '../src/platform/modules.js'

test('classifies every current module as skeleton, feature, or migration', async () => {
  const catalog = await loadModuleCatalog()
  const summary = summarizeModules(catalog)
  assert.ok(summary.classification.skeleton >= 10)
  assert.ok(summary.runtime.active >= 4)
  assert.ok(summary.runtime.compat >= 8)
  assert.ok(summary.implementation.ready >= 20)
  assert.equal(catalog.modules.some(module => module.classification === 'migration' && !module.exitCriteria), false)
  const modules = new Map(catalog.modules.map(module => [module.id, module]))
  assert.equal(modules.get('durable-state-contract')?.classification, 'skeleton')
  assert.equal(modules.get('control-console')?.classification, 'feature')
  assert.equal(modules.get('application-composition')?.dependsOn.includes('control-console'), false)
  assert.equal(modules.get('sqlite-storage')?.classification, 'feature')
  assert.equal(modules.get('postgres-storage')?.runtime, 'inactive')
  assert.equal(modules.get('application-composition')?.dependsOn.includes('durable-state-host'), false)
  assert.ok(modules.get('application-composition')?.owns.includes('src/bootstrap/config.ts'))
  assert.ok(modules.get('durable-state-host')?.owns.includes('src/storage/config.ts'))
  assert.ok(modules.get('bridge-compat-host')?.owns.includes('src/config/runtime.ts'))
})

test('prevents the skeleton from depending on a feature', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'feature-a', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active', source: 'a', owns: [], dependsOn: [] },
      { id: 'skeleton-a', classification: 'skeleton', layer: 'kernel', implementation: 'ready', runtime: 'active', source: 'b', owns: [], dependsOn: ['feature-a'] },
    ],
  }), /skeleton module skeleton-a cannot depend on feature module feature-a/)
})

test('prevents feature code from acquiring a migration dependency', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'migration-a', classification: 'migration', layer: 'operations', implementation: 'ready', runtime: 'active', source: 'a', owns: [], dependsOn: [], exitCriteria: 'remove it' },
      { id: 'feature-a', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active', source: 'b', owns: [], dependsOn: ['migration-a'] },
    ],
  }), /feature module feature-a cannot depend on migration module migration-a/)
})

test('applies classification boundaries to runtime-only dependencies', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'migration-a', classification: 'migration', layer: 'operations', implementation: 'ready', runtime: 'active', source: 'a', owns: [], dependsOn: [], exitCriteria: 'remove it' },
      { id: 'feature-a', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active', source: 'b', owns: [], dependsOn: [], runtimeDependsOn: ['migration-a'] },
    ],
  }), /feature module feature-a cannot depend on migration module migration-a/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'skeleton-a', classification: 'skeleton', layer: 'kernel', implementation: 'ready', runtime: 'active', source: 'a', owns: [], dependsOn: [] },
      { id: 'feature-a', classification: 'feature', layer: 'provider', implementation: 'ready', runtime: 'active', source: 'b', owns: [], dependsOn: [] },
      { id: 'skeleton-b', classification: 'skeleton', layer: 'kernel', implementation: 'ready', runtime: 'active', source: 'c', owns: [], dependsOn: [], runtimeDependsOn: ['feature-a'] },
    ],
  }), /skeleton module skeleton-b cannot depend on feature module feature-a/)
})

test('rejects dependency cycles and compat features without a migration host', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'feature-a', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'compat', source: 'a', owns: [], hostedBy: 'missing', dependsOn: [] },
    ],
  }), /must name a migration host/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'a', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active', source: 'a', owns: [], dependsOn: ['b'] },
      { id: 'b', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active', source: 'b', owns: [], dependsOn: ['a'] },
    ],
  }), /module dependency cycle/)
})

test('requires every source file to have exactly one explicit module owner', () => {
  const catalog = validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'contracts', classification: 'skeleton', layer: 'contract', implementation: 'ready', runtime: 'active', source: 'src/domain/contracts.ts', owns: ['src/domain/contracts.ts'], dependsOn: [] },
    ],
  })
  assert.doesNotThrow(() => validateSourceOwnership(catalog, ['src/domain/contracts.ts']))
  assert.throws(() => validateSourceOwnership(catalog, ['src/domain/contracts.ts', 'src/domain/new-contract.ts']), /unowned source: src\/domain\/new-contract.ts/)
  assert.throws(() => validateSourceOwnership(catalog, []), /owned source does not exist: src\/domain\/contracts.ts/)

  const compatibility = validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'host', classification: 'migration', layer: 'operations', implementation: 'ready', runtime: 'active', source: 'src/host.ts', owns: ['src/host.ts'], dependsOn: [], exitCriteria: 'remove it' },
      { id: 'legacy-feature', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'compat', source: 'packages/bridge-compat/src/feature.js', owns: ['packages/bridge-compat/src/feature.js'], hostedBy: 'host', dependsOn: [] },
    ],
  })
  assert.doesNotThrow(() => validateSourceOwnership(compatibility, ['src/host.ts', 'packages/bridge-compat/src/feature.js']))

  const operations = validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'operations', classification: 'feature', layer: 'operations', implementation: 'ready', runtime: 'active', source: 'scripts/example.ts', owns: ['scripts/example.ts', 'scripts/replay.mjs'], dependsOn: [] },
    ],
  })
  assert.doesNotThrow(() => validateSourceOwnership(operations, ['scripts/example.ts', 'scripts/replay.mjs']))
})

test('requires every tracked runtime asset to have exactly one module owner', () => {
  const catalog = validateModuleCatalog({
    version: 3,
    modules: [
      {
        id: 'surface', classification: 'feature', layer: 'surface', implementation: 'ready', runtime: 'active',
        source: 'src/surface.ts', owns: ['src/surface.ts'], assets: ['web/index.html'], dependsOn: [],
      },
    ],
  })
  assert.doesNotThrow(() => validateAssetOwnership(catalog, ['web/index.html']))
  assert.throws(() => validateAssetOwnership(catalog, ['web/index.html', 'web/app.js']), /unowned runtime asset: web\/app\.js/)
  assert.throws(() => validateAssetOwnership(catalog, []), /owned runtime asset does not exist or is not tracked: web\/index\.html/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'a', classification: 'feature', layer: 'surface', implementation: 'ready', runtime: 'active', source: 'a', owns: [], assets: ['web/index.html'], dependsOn: [] },
      { id: 'b', classification: 'feature', layer: 'surface', implementation: 'ready', runtime: 'active', source: 'b', owns: [], assets: ['web/index.html'], dependsOn: [] },
    ],
  }), /asset web\/index\.html is owned by both a and b/)
})

test('rejects duplicate ownership and src entrypoints that are not owned', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'a', classification: 'skeleton', layer: 'contract', implementation: 'ready', runtime: 'active', source: 'src/domain/a.ts', owns: ['src/domain/a.ts'], dependsOn: [] },
      { id: 'b', classification: 'skeleton', layer: 'contract', implementation: 'ready', runtime: 'active', source: 'src/domain/b.ts', owns: ['src/domain/a.ts', 'src/domain/b.ts'], dependsOn: [] },
    ],
  }), /source src\/domain\/a.ts is owned by both a and b/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'a', classification: 'skeleton', layer: 'contract', implementation: 'ready', runtime: 'active', source: 'src/domain/a.ts', owns: [], dependsOn: [] },
    ],
  }), /must own its src entrypoint/)
})

test('separates effect implementation from runtime activation', () => {
  const planned = validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'workflow', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'inactive', source: 'workflow', owns: [], dependsOn: [], requiresEffects: ['task-system.read.v1'] },
    ],
  })
  assert.deepEqual(analyzeEffectCoverage(planned), {
    required: ['task-system.read.v1'], declared: [], implemented: [], active: [],
    missingImplementation: ['task-system.read.v1'], inactive: [],
  })
  const implemented = validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'workflow', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'inactive', source: 'workflow', owns: [], dependsOn: [], requiresEffects: ['task-system.read.v1'] },
      { id: 'adapter', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', source: 'adapter', owns: [], dependsOn: [], providesEffects: ['task-system.read.v1'] },
    ],
  })
  assert.deepEqual(analyzeEffectCoverage(implemented).inactive, ['task-system.read.v1'])
  assert.deepEqual(analyzeEffectCoverage(implemented).missingImplementation, [])
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'workflow', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active', source: 'workflow', owns: [], dependsOn: [], requiresEffects: ['task-system.read.v1'] },
    ],
  }), /active module workflow requires inactive effect task-system\.read\.v1/)
})

test('rejects active unfinished modules and the ambiguous legacy status field', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{ id: 'unfinished', classification: 'feature', layer: 'adapter', implementation: 'partial', runtime: 'active', source: 'a', owns: [], dependsOn: [] }],
  }), /active module unfinished must have a ready implementation/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{ id: 'legacy', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', status: 'planned', source: 'a', owns: [], dependsOn: [] }],
  }), /ambiguous legacy status/)
})

test('fails closed for misspelled fields and invalid migration ownership combinations', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [],
    module: [],
  }), /module catalog has unknown fields: module/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{
      id: 'typo', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive',
      source: 'a', owns: [], dependsOn: [], runtimeDependOn: [],
    }],
  }), /unknown fields: runtimeDependOn/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{
      id: 'ordinary', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'inactive',
      source: 'a', owns: [], dependsOn: [], hostedBy: 'migration-a',
    }],
  }), /can declare hostedBy only with runtime=compat/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{
      id: 'ordinary', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'inactive',
      source: 'a', owns: [], dependsOn: [], exitCriteria: 'delete later',
    }],
  }), /only migration modules can declare exitCriteria/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{
      id: 'migration-a', classification: 'migration', layer: 'operations', implementation: 'ready', runtime: 'compat',
      source: 'a', owns: [], dependsOn: [], hostedBy: 'migration-a', exitCriteria: 'delete later',
    }],
  }), /only feature modules can use runtime=compat/)
})

test('rejects module source paths that escape the project', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{
      id: 'escape', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive',
      source: '../outside.ts', owns: [], dependsOn: [],
    }],
  }), /must be a normalized project-relative path/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [{
      id: 'windows-escape', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive',
      source: '..\\outside.ts', owns: [], dependsOn: [],
    }],
  }), /must be a normalized project-relative path/)
})

test('requires each effect to have only one provider', () => {
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'a', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', source: 'a', owns: [], dependsOn: [], providesEffects: ['task-system.read.v1'] },
      { id: 'b', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', source: 'b', owns: [], dependsOn: [], providesEffects: ['task-system.read.v1'] },
    ],
  }), /effect task-system\.read\.v1 is provided by both a and b/)
})

test('requires plugin profile ids and package exports to have one module owner', () => {
  const plugin = { profileId: 'shared-plugin', packageExport: './shared-plugin' }
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'a', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', source: 'a', owns: [], dependsOn: [], plugin },
      { id: 'b', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', source: 'b', owns: [], dependsOn: [], plugin: { profileId: 'shared-plugin', packageExport: './other' } },
    ],
  }), /plugin profile shared-plugin is owned by both a and b/)
  assert.throws(() => validateModuleCatalog({
    version: 3,
    modules: [
      { id: 'a', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', source: 'a', owns: [], dependsOn: [], plugin },
      { id: 'b', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'inactive', source: 'b', owns: [], dependsOn: [], plugin: { profileId: 'other-plugin', packageExport: './shared-plugin' } },
    ],
  }), /plugin export \.\/shared-plugin is owned by both a and b/)
})
