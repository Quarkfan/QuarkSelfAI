import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModuleCatalog } from '../src/catalog/file-provider.js'
import { validateModuleCatalog, type AssistantModuleCatalog } from '../src/platform/modules.js'
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
  assert.throws(() => loadNativeProductConfig(manifest, { ...environment, DSH_NATIVE_PROFILE: 'feishu-assistant' }), /cannot reuse the compatibility DSH profile/)
  assert.throws(() => loadNativeProductConfig(manifest, { ...environment, QUARK_NATIVE_MESSAGE_INTAKE: 'false' }), /activation is incomplete: QUARK_NATIVE_MESSAGE_INTAKE/)
  assert.throws(() => loadNativeProductConfig(manifest, { ...environment, DIDA_PROJECT_ID: '' }), /configuration is incomplete: DIDA_PROJECT_ID/)
  const config = loadNativeProductConfig(manifest, environment)
  assert.equal(config.kernel.mode === 'dsh' && config.kernel.profile, 'feishu-assistant-native')
  await assert.rejects(() => createNativeProductApplication(config, manifest), /native product modules are not ready/)
})

test('native status and readiness derive from the product manifest instead of migration parity', async () => {
  const catalog = await loadModuleCatalog()
  assert.equal(catalog.modules.find(module => module.id === 'message-intake-native')?.runtimeDependsOn.includes('durable-workflow-runtime'), false)
  assert.ok(catalog.modules.find(module => module.id === 'message-intake-native')?.requiresServices.includes('quarkWorkflows'))
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

  const brokenRuntimeCatalog: AssistantModuleCatalog = {
    ...readyCatalog,
    modules: readyCatalog.modules.map(module => module.id === 'durable-workflow-runtime'
      ? { ...module, runtime: 'inactive' as const }
      : module),
  }
  const degraded = new NativeProductRuntimeStatus(readyKernel, brokenRuntimeCatalog, manifest, 'sqlite-storage').snapshot()
  assert.equal(degraded.state, 'degraded')
  assert.match(degraded.capabilities.find(capability => capability.id === 'platform-runtime-dependencies')?.detail ?? '', /durable-workflow-runtime/)
  const blocked = await new NativeProductReadiness({ load: async () => brokenRuntimeCatalog }, manifest, 'sqlite-storage').inspect()
  assert.equal(blocked.state, 'blocked')
  assert.ok(blocked.blockers.includes('durable-workflow-runtime'))
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

test('native readiness follows service providers without concrete runtime dependencies', async () => {
  const activeCatalog = validateModuleCatalog({
    version: 3,
    modules: [
      {
        id: 'consumer', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active',
        source: 'consumer', owns: [], dependsOn: [], requiresServices: ['examplePort'],
      },
      {
        id: 'provider', classification: 'feature', layer: 'provider', implementation: 'ready', runtime: 'active',
        source: 'provider', owns: [], dependsOn: [], providesServices: ['examplePort'],
      },
    ],
  })
  const manifest = validateProductCompositionManifest({
    version: 1,
    capabilities: [{ id: 'example', required: true, modules: ['consumer'] }],
    requiredEnvironment: [],
    requiredConfiguration: [],
  }, activeCatalog)
  const degradedCatalog: AssistantModuleCatalog = {
    ...activeCatalog,
    modules: activeCatalog.modules.map(module => module.id === 'provider'
      ? { ...module, runtime: 'inactive' as const }
      : module),
  }
  const runtime = new NativeProductRuntimeStatus(readyKernel, degradedCatalog, manifest, 'consumer').snapshot()
  assert.equal(runtime.state, 'degraded')
  assert.match(runtime.capabilities.find(capability => capability.id === 'platform-runtime-dependencies')?.detail ?? '', /provider/)
  const readiness = await new NativeProductReadiness({ load: async () => degradedCatalog }, manifest, 'consumer').inspect()
  assert.equal(readiness.state, 'blocked')
  assert.ok(readiness.blockers.includes('provider'))
})

test('native readiness follows effect providers without concrete runtime dependencies', async () => {
  const activeCatalog = validateModuleCatalog({
    version: 3,
    modules: [
      {
        id: 'workflow', classification: 'feature', layer: 'workflow', implementation: 'ready', runtime: 'active',
        source: 'workflow', owns: [], dependsOn: [], requiresEffects: ['example.run.v1'],
      },
      {
        id: 'adapter', classification: 'feature', layer: 'adapter', implementation: 'ready', runtime: 'active',
        source: 'adapter', owns: [], dependsOn: [], providesEffects: ['example.run.v1'],
      },
    ],
  })
  const manifest = validateProductCompositionManifest({
    version: 1,
    capabilities: [{ id: 'example', required: true, modules: ['workflow'] }],
    requiredEnvironment: [],
    requiredConfiguration: [],
  }, activeCatalog)
  const degradedCatalog: AssistantModuleCatalog = {
    ...activeCatalog,
    modules: activeCatalog.modules.map(module => module.id === 'adapter'
      ? { ...module, runtime: 'inactive' as const }
      : module),
  }
  const runtime = new NativeProductRuntimeStatus(readyKernel, degradedCatalog, manifest, 'workflow').snapshot()
  assert.equal(runtime.state, 'degraded')
  assert.match(runtime.capabilities.find(capability => capability.id === 'platform-runtime-dependencies')?.detail ?? '', /adapter/)
  const readiness = await new NativeProductReadiness({ load: async () => degradedCatalog }, manifest, 'workflow').inspect()
  assert.equal(readiness.state, 'blocked')
  assert.ok(readiness.blockers.includes('adapter'))
})
