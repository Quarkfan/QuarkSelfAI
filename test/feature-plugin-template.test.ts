import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateModuleCatalog } from '../src/platform/modules.js'

test('feature template is a valid inactive module-catalog v2 extension', async () => {
  const fragment = JSON.parse(await readFile(new URL('../templates/feature-plugin/module.fragment.json', import.meta.url), 'utf8'))
  const catalog = validateModuleCatalog({
    version: 2,
    modules: [
      {
        id: 'assistant-contracts', classification: 'skeleton', layer: 'contract',
        implementation: 'ready', runtime: 'active', source: 'contract:assistant',
        owns: [], dependsOn: [], requiresEffects: [], providesEffects: [],
      },
      fragment,
    ],
  })
  const feature = catalog.modules[1]
  assert.equal(feature?.classification, 'feature')
  assert.equal(feature?.implementation, 'ready')
  assert.equal(feature?.runtime, 'inactive')
  assert.deepEqual(feature?.owns, ['src/features/feature-id/plugin.ts'])
})

test('feature template ships a fail-closed Cordis activation gate', async () => {
  const source = await readFile(new URL('../templates/feature-plugin/cordis.fragment.yml', import.meta.url), 'utf8')
  assert.match(source, /disabled:.*QUARK_FEATURE_ID_ENABLED/s)
  assert.doesNotMatch(source, /ASSISTANT_RUNTIME\s*!==\s*['"]compat/)
})
