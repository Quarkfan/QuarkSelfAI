import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModuleCatalog } from '../src/catalog/file-provider.js'
import type { AssistantModuleCatalog } from '../src/platform/modules.js'
import type { KernelStatusProvider } from '../src/platform/operations.js'
import { createNativeProductApplication } from '../src/product/composition.js'
import { loadNativeProductConfig } from '../src/product/config.js'
import {
  loadProductCompositionManifest,
  productModuleIds,
  validateProductCompositionManifest,
} from '../src/product/manifest.js'
import { NativeProductReadiness, NativeProductRuntimeStatus } from '../src/product/status.js'

const readyKernel: KernelStatusProvider = { snapshot: () => ({ mode: 'dsh', state: 'ready' }) }

test('long-term product composition contains every native owner and no migration module', async () => {
  const catalog = await loadModuleCatalog()
  const manifest = await loadProductCompositionManifest(catalog)
  const ids = new Set(productModuleIds(manifest))
  assert.ok(ids.has('native-product-composition'))
  assert.ok(ids.has('agent-bound-action-worker'))
  assert.ok(ids.has('message-intake-native'))
  assert.equal([...ids].some(id => catalog.modules.find(module => module.id === id)?.classification === 'migration'), false)
  assert.equal(new Set(manifest.requiredEnvironment).size, manifest.requiredEnvironment.length)
})

test('product manifest rejects unknown, temporary, and multiply-owned modules', async () => {
  const catalog = await loadModuleCatalog()
  const base = { version: 1, requiredEnvironment: [], requiredConfiguration: [] }
  assert.throws(() => validateProductCompositionManifest({
    ...base, capabilities: [{ id: 'unknown', required: true, modules: ['missing-module'] }],
  }, catalog), /unknown module missing-module/)
  assert.throws(() => validateProductCompositionManifest({
    ...base, capabilities: [{ id: 'temporary', required: true, modules: ['bridge-compat-host'] }],
  }, catalog), /temporary module bridge-compat-host/)
  assert.throws(() => validateProductCompositionManifest({
    ...base,
    capabilities: [
      { id: 'first', required: true, modules: ['control-console'] },
      { id: 'second', required: false, modules: ['control-console'] },
    ],
  }, catalog), /belongs to multiple capabilities/)
})

test('native product entry fails closed on mode, activation gates, and inactive modules', async () => {
  const catalog = await loadModuleCatalog()
  const manifest = await loadProductCompositionManifest(catalog)
  const activation = Object.fromEntries(manifest.requiredEnvironment.map(name => [name, 'true']))
  const configuration = Object.fromEntries(manifest.requiredConfiguration.map(name => [name, '/configured']))
  const environment = { ...activation, ...configuration, ASSISTANT_RUNTIME: 'native', ASSISTANT_KERNEL: 'dsh' }
  assert.throws(() => loadNativeProductConfig(manifest, { ...environment, ASSISTANT_RUNTIME: 'compat' }), /requires ASSISTANT_RUNTIME=native/)
  assert.throws(() => loadNativeProductConfig(manifest, { ...environment, QUARK_NATIVE_MESSAGE_INTAKE: 'false' }), /activation is incomplete: QUARK_NATIVE_MESSAGE_INTAKE/)
  assert.throws(() => loadNativeProductConfig(manifest, { ...environment, DIDA_PROJECT_ID: '' }), /configuration is incomplete: DIDA_PROJECT_ID/)
  const config = loadNativeProductConfig(manifest, environment)
  await assert.rejects(() => createNativeProductApplication(config, manifest), /native product modules are not ready/)
})

test('native status and readiness derive from the product manifest instead of migration parity', async () => {
  const catalog = await loadModuleCatalog()
  const manifest = await loadProductCompositionManifest(catalog)
  const current = new NativeProductRuntimeStatus(readyKernel, catalog, manifest, 'sqlite-storage').snapshot()
  assert.equal(current.mode, 'native-product')
  assert.equal(current.state, 'degraded')
  assert.ok(current.capabilities.some(capability => capability.id === 'delegated-execution' && capability.state === 'degraded'))

  const productIds = new Set(productModuleIds(manifest))
  const readyCatalog: AssistantModuleCatalog = {
    ...catalog,
    modules: catalog.modules.map(module => productIds.has(module.id) ? { ...module, runtime: 'active' as const } : module),
  }
  const ready = new NativeProductRuntimeStatus(readyKernel, readyCatalog, manifest, 'sqlite-storage').snapshot()
  assert.equal(ready.state, 'ready')
  const readiness = await new NativeProductReadiness({ load: async () => readyCatalog }, manifest, 'sqlite-storage').inspect()
  assert.equal(readiness.id, 'native-product')
  assert.equal(readiness.state, 'ready')
  assert.deepEqual(readiness.blockers, [])
})

test('optional product capabilities remain visible without blocking native startup readiness', async () => {
  const catalog = await loadModuleCatalog()
  const manifest = validateProductCompositionManifest({
    version: 1,
    capabilities: [
      { id: 'required-console', required: true, modules: ['control-console'] },
      { id: 'optional-postgres', required: false, modules: ['postgres-storage'] },
    ],
    requiredEnvironment: [],
    requiredConfiguration: [],
  }, catalog)
  const runtime = new NativeProductRuntimeStatus(readyKernel, catalog, manifest, 'sqlite-storage').snapshot()
  assert.equal(runtime.state, 'ready')
  assert.equal(runtime.capabilities.find(capability => capability.id === 'optional-postgres')?.state, 'degraded')
  const readiness = await new NativeProductReadiness({ load: async () => catalog }, manifest, 'sqlite-storage').inspect()
  assert.equal(readiness.state, 'ready')
  assert.deepEqual(readiness.blockers, [])
  assert.ok(readiness.items.some(item => item.id === 'postgres-storage' && item.status === 'ready/inactive'))
})
