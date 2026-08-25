import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateModuleCatalog } from '../src/platform/modules.js'

test('feature template is a valid inactive module-catalog v3 extension', async () => {
  const fragment = JSON.parse(await readFile(new URL('../templates/feature-plugin/module.fragment.json', import.meta.url), 'utf8'))
  const catalog = validateModuleCatalog({
    version: 3,
    modules: [
      {
        id: 'dsh-runtime', classification: 'skeleton', layer: 'kernel',
        implementation: 'ready', runtime: 'active', source: 'runtime:dsh',
        owns: [], dependsOn: [], requiresEffects: [], providesEffects: [],
      },
      {
        id: 'storage-port', classification: 'skeleton', layer: 'contract',
        implementation: 'ready', runtime: 'static', source: 'src/storage/types.ts',
        owns: ['src/storage/types.ts'], dependsOn: [],
      },
      {
        id: 'durable-workflow-contracts', classification: 'skeleton', layer: 'contract',
        implementation: 'ready', runtime: 'static', source: 'src/workflow/contracts.ts',
        owns: ['src/workflow/contracts.ts'], dependsOn: ['storage-port'],
      },
      {
        id: 'durable-workflow-runtime', classification: 'skeleton', layer: 'kernel',
        implementation: 'ready', runtime: 'active', source: 'src/workflow/runtime.ts',
        owns: ['src/workflow/runtime.ts'], dependsOn: ['durable-workflow-contracts'], runtimeDependsOn: ['dsh-runtime'],
      },
      fragment,
    ],
  })
  const feature = catalog.modules[4]
  assert.equal(feature?.classification, 'feature')
  assert.equal(feature?.implementation, 'planned')
  assert.equal(feature?.runtime, 'inactive')
  assert.deepEqual(feature?.owns, ['src/features/feature-id/plugin.ts'])
  assert.deepEqual(feature?.assets, [])
  assert.deepEqual(feature?.dependsOn, ['durable-workflow-contracts'])
  assert.deepEqual(feature?.runtimeDependsOn, ['dsh-runtime', 'durable-workflow-runtime'])
  assert.deepEqual(feature?.plugin, { profileId: 'feature-id', packageExport: './feature-id' })
})

test('feature template ships a fail-closed Cordis activation gate', async () => {
  const source = await readFile(new URL('../templates/feature-plugin/cordis.fragment.yml', import.meta.url), 'utf8')
  assert.match(source, /disabled:.*QUARK_FEATURE_ID_ENABLED/s)
  assert.doesNotMatch(source, /ASSISTANT_RUNTIME\s*!==\s*['"]compat/)
})

test('feature template starts honestly and documents both durable write planes', async () => {
  const readme = await readFile(new URL('../templates/feature-plugin/README.md', import.meta.url), 'utf8')
  const plugin = await readFile(new URL('../templates/feature-plugin/plugin.ts.template', import.meta.url), 'utf8')
  assert.match(readme, /planned[\s\S]*partial[\s\S]*ready/)
  assert.match(readme, /action\/approval/)
  assert.match(readme, /workflow effect\/outbox/)
  assert.match(readme, /不得新增业务 `setInterval`/)
  assert.match(plugin, /const workflows: DurableWorkflowPort = ctx\.quarkWorkflows/)
  assert.doesNotMatch(plugin, /setInterval\s*\(/)
})
