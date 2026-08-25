import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { analyzeEffectCoverage, summarizeModules, validateAssetOwnership, validateSourceOwnership } from '../src/platform/modules.js'
import { loadModuleCatalog } from '../src/catalog/file-provider.js'
import { ControlOnlyRuntime } from '../src/platform/defaults.js'
import { loadProductCompositionManifest, productModuleIds } from '../src/product/manifest.js'
import { DEFAULT_EVENT_RECOVERY_POLL_INTERVAL_MS } from '../src/events/runtime.js'
import { DEFAULT_WORKFLOW_RECOVERY_POLL_INTERVAL_MS } from '../src/workflow/runtime.js'
import { DEFAULT_ACTION_RECOVERY_POLL_INTERVAL_MS } from '../src/execution/worker-plugin.js'

const root = process.cwd()
const catalog = await loadModuleCatalog()
for (const module of catalog.modules) await access(resolve(root, module.source))
for (const module of catalog.modules) {
  if (module.classification === 'migration' || module.runtime === 'compat') continue
  const ownedPaths = [module.source, ...module.owns, ...(module.assets ?? [])]
  assert.deepEqual(
    ownedPaths.filter(path => path.startsWith('compat/') || path.startsWith('packages/bridge-compat/')),
    [],
    `long-term module ${module.id} cannot own compatibility paths`,
  )
}
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  name?: unknown
  exports?: unknown
  dsh?: { bundle?: { patch?: unknown } }
}
const packageName = typeof packageManifest.name === 'string' ? packageManifest.name : ''
assert.ok(packageName, 'package.json must define a package name')
assert.ok(isRecord(packageManifest.exports), 'package.json must define exports')
assert.equal(packageManifest.dsh?.bundle?.patch, './cordis.patch.yml', 'DSH bundle must load the long-term native product profile')
const profileSource = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
const compatibilityProfileSource = await readFile(resolve(root, 'compat/cordis.compat.patch.yml'), 'utf8')
const productManifest = await loadProductCompositionManifest(catalog)
const platformApiSource = await readFile(resolve(root, 'src/platform/index.ts'), 'utf8')
const operationsContractSource = await readFile(resolve(root, 'src/platform/operations.ts'), 'utf8')
const storagePortsSource = await readFile(resolve(root, 'src/storage/ports.ts'), 'utf8')
const durableStateContractSource = await readFile(resolve(root, 'src/storage/service-contract.ts'), 'utf8')
const channelContractSource = await readFile(resolve(root, 'src/domain/channel.ts'), 'utf8')
assert.ok(!platformApiSource.includes("export type * from '../storage/types.js'"), 'platform API must export the intentional storage port surface')
assert.doesNotMatch(platformApiSource, /workspace-policy|lifecycle/, 'stable platform API cannot export replaceable runtime implementations')
assert.ok(!/\b(?:AssistantStore|StorageConfig)\b/.test(storagePortsSource), 'public storage ports must not expose provider aggregate or configuration')
assert.ok(!/\b(?:messageReady|cardReady|requiredEventKeys|readyEventKeys)\b/.test(operationsContractSource), 'runtime status contract must expose open capabilities instead of channel-specific readiness fields')
assert.ok(durableStateContractSource.includes("'quark/event-wake'(at?: string)"), 'durable event contract must expose immediate and exact retry wake hints')
assert.ok(!durableStateContractSource.includes('quark/event-appended'), 'append-only event hints cannot represent exact retries')
assert.match(channelContractSource, /readonly kind: ChannelEventKind/, 'channel event kind must remain an open adapter-owned id')
assert.doesNotMatch(channelContractSource, /readonly kind:\s*['"][^\n]+\|/, 'channel contract must not close the event kind vocabulary')
const profilePlugins = cordisPlugins(profileSource)
assert.ok(DEFAULT_EVENT_RECOVERY_POLL_INTERVAL_MS >= 600_000, 'durable event fallback polling must be at least ten minutes')
assert.ok(DEFAULT_WORKFLOW_RECOVERY_POLL_INTERVAL_MS >= 600_000, 'durable workflow fallback polling must be at least ten minutes')
assert.ok(DEFAULT_ACTION_RECOVERY_POLL_INTERVAL_MS >= 600_000, 'durable action fallback polling must be at least ten minutes')
for (const profileId of ['quark-agent-action-worker', 'quark-durable-events', 'quark-durable-workflows']) {
  assert.match(profilePlugins.get(profileId)?.block ?? '', /pollIntervalMs:\s*600000\b/, `${profileId} must use ten-minute recovery polling`)
}
const pluginBindings = catalog.modules.flatMap(module => module.plugin ? [{ module, plugin: module.plugin }] : [])
for (const { module, plugin } of pluginBindings) {
  assert.ok(plugin.packageExport in packageManifest.exports, `module ${module.id} references missing package export ${plugin.packageExport}`)
  assertPackageExportOwned(packageManifest.exports[plugin.packageExport], module.id, module.owns)
  const expectedPackage = plugin.packageExport === '.' ? packageName : `${packageName}/${plugin.packageExport.slice(2)}`
  const mounted = profilePlugins.get(plugin.profileId)
  assert.equal(mounted?.name, expectedPackage, `module ${module.id} plugin binding differs from cordis.patch.yml`)
  const activationGated = /disabled:[\s\S]*QUARK_NATIVE_[A-Z_]+/.test(mounted?.block ?? '')
  if (module.runtime === 'inactive') {
    assert.ok(activationGated, `inactive module ${module.id} must be activation-gated in cordis.patch.yml`)
  }
  if (module.runtime === 'active' || module.runtime === 'shadow') {
    assert.ok(!activationGated, `${module.runtime} module ${module.id} cannot be native-activation-gated in cordis.patch.yml`)
  }
}
assertPackageExportOwned(packageManifest.exports['./platform'], 'platform-api', catalog.modules.find(module => module.id === 'platform-api')?.owns ?? [])
const boundProfileIds = new Set(pluginBindings.map(binding => binding.plugin.profileId))
for (const [profileId, mounted] of profilePlugins) {
  if (mounted.name === packageName || mounted.name.startsWith(`${packageName}/`)) {
    assert.ok(boundProfileIds.has(profileId), `local Cordis plugin ${profileId} is not owned by a module catalog binding`)
  }
}
assert.doesNotMatch(profileSource, /\b(?:ASSISTANT_RUNTIME|compatibility|compat)\b/i, 'long-term Cordis bundle cannot contain migration semantics')
const profileCompositions = catalog.modules.filter(module => module.source === 'cordis.patch.yml')
assert.equal(profileCompositions.length, 1, 'the native Cordis profile must have exactly one catalog owner')
const profileComposition = profileCompositions[0]!
assert.equal(profileComposition.id, 'native-product-profile', 'the long-term bundle must be owned by native-product-profile')
assert.equal(profileComposition.classification, 'feature', 'the long-term Cordis profile must be a feature')
assert.equal(profileComposition.runtime, 'shadow', 'the native Cordis profile remains shadow-mounted until native ownership cutover')
assert.ok(profileComposition.runtimeDependsOn.includes('dsh-runtime'), 'the native Cordis profile must depend on the DSH runtime')
for (const { module } of pluginBindings) {
  assert.ok(profileComposition.mounts.includes(module.id), `native Cordis profile does not mount plugin module ${module.id}`)
}
assert.deepEqual(profileComposition.runtimeDependsOn, ['dsh-runtime'], 'native Cordis profile runtime dependencies cannot duplicate mounted plugins')
const compatibilityProfileCompositions = catalog.modules.filter(module => module.source === 'compat/cordis.compat.patch.yml')
assert.equal(compatibilityProfileCompositions.length, 1, 'the compatibility profile overlay must have exactly one catalog owner')
assert.equal(compatibilityProfileCompositions[0]?.classification, 'migration', 'the compatibility profile overlay must remain migration-owned')
assert.deepEqual(
  [...compatibilityProfileCompositions[0]!.runtimeDependsOn].sort(),
  ['dsh-runtime'],
  'the compatibility overlay may require only the DSH runtime',
)
assert.deepEqual(compatibilityProfileCompositions[0]!.mounts, ['native-product-profile'], 'compatibility overlay must compose over the native product profile')
assert.doesNotMatch(compatibilityProfileSource, /ASSISTANT_RUNTIME|QUARK_NATIVE_/, 'compatibility overlay must disable exact owners without copying activation policy')
const compatibilityEntries = cordisPatchEntries(compatibilityProfileSource)
const inactiveProfileIds = pluginBindings
  .filter(({ module }) => module.classification === 'feature' && module.runtime === 'inactive')
  .map(({ plugin }) => plugin.profileId)
  .sort()
assert.deepEqual([...compatibilityEntries.keys()].sort(), inactiveProfileIds, 'compatibility overlay must disable every inactive native plugin exactly once')
for (const [profileId, block] of compatibilityEntries) {
  assert.match(block, /\bdisabled:\s*true\b/, `compatibility overlay entry ${profileId} must fail closed`)
  assert.doesNotMatch(block, /\bname:/, `compatibility overlay entry ${profileId} cannot remount a plugin`)
}
const migrationPlan = JSON.parse(await readFile(resolve(root, 'config/native-migration-plan.json'), 'utf8')) as {
  version?: unknown
  sourceRuntime?: unknown
  units?: unknown
  exitUnits?: unknown
  [key: string]: unknown
}
assert.deepEqual(Object.keys(migrationPlan).sort(), ['exitUnits', 'sourceRuntime', 'units', 'version'], 'native migration plan has unknown or missing top-level fields')
assert.equal(migrationPlan.version, 3, 'native migration plan must be version 3')
assert.equal(migrationPlan.sourceRuntime, 'bridge-compat-host', 'native migration plan must identify the compatibility host')
assert.ok(Array.isArray(migrationPlan.units), 'native migration plan must contain units')
assert.ok(Array.isArray(migrationPlan.exitUnits), 'native migration plan must contain exitUnits')
const migrationUnits = migrationPlan.units as Array<Record<string, unknown>>
const cutoverFields = ['buildOrder', 'cutoverAfter', 'cutoverBoundary', 'id', 'modules', 'requiresMaintenanceWindow', 'rollback', 'stateOwner', 'targetModules']
const migrationModuleIds: string[] = []
const migrationUnitIds = new Set(migrationUnits.map(unit => unit.id))
assert.equal(migrationUnitIds.size, migrationUnits.length, 'migration unit ids must be unique')
const buildOrders = new Set<number>()
for (const unit of migrationUnits) {
  assert.deepEqual(Object.keys(unit).sort(), cutoverFields, `migration unit ${String(unit.id)} has unknown or missing fields`)
  assert.equal(typeof unit.id, 'string', 'migration unit id must be a string')
  assert.ok(Array.isArray(unit.modules) && unit.modules.length > 0 && unit.modules.every(value => typeof value === 'string'), `migration unit ${String(unit.id)} must contain module ids`)
  assert.ok(Array.isArray(unit.targetModules) && unit.targetModules.length > 0 && unit.targetModules.every(value => typeof value === 'string'), `migration unit ${String(unit.id)} must contain target module ids`)
  assert.equal(new Set(unit.targetModules as string[]).size, (unit.targetModules as string[]).length, `migration unit ${String(unit.id)} target modules must be unique`)
  for (const targetId of unit.targetModules as string[]) {
    const target = catalog.modules.find(module => module.id === targetId)
    assert.ok(target, `migration unit ${String(unit.id)} references unknown target module ${targetId}`)
    assert.equal(target.classification, 'feature', `migration target ${targetId} must be a feature`)
    assert.notEqual(target.runtime, 'compat', `migration target ${targetId} cannot remain compatibility-owned`)
  }
  assert.equal(typeof unit.cutoverBoundary, 'string', `migration unit ${String(unit.id)} must define its cutover boundary`)
  assert.equal(typeof unit.rollback, 'string', `migration unit ${String(unit.id)} must define rollback`)
  assert.equal(unit.requiresMaintenanceWindow, true, `migration unit ${String(unit.id)} must require a maintenance window`)
  assert.ok(Number.isSafeInteger(unit.buildOrder) && Number(unit.buildOrder) > 0, `migration unit ${String(unit.id)} must define a positive buildOrder`)
  assert.ok(!buildOrders.has(Number(unit.buildOrder)), `migration buildOrder ${String(unit.buildOrder)} must be unique`)
  buildOrders.add(Number(unit.buildOrder))
  assert.ok(Array.isArray(unit.cutoverAfter) && unit.cutoverAfter.every(value => typeof value === 'string'), `migration unit ${String(unit.id)} must define cutoverAfter`)
  for (const dependency of unit.cutoverAfter as string[]) {
    assert.ok(migrationUnitIds.has(dependency), `migration unit ${String(unit.id)} has unknown cutover dependency ${dependency}`)
    assert.notEqual(dependency, unit.id, `migration unit ${String(unit.id)} cannot cut over after itself`)
  }
  migrationModuleIds.push(...unit.modules as string[])
}
assertAcyclicCutovers(migrationUnits)
assert.deepEqual([...buildOrders].sort((left, right) => left - right), migrationUnits.map((_, index) => index + 1), 'migration buildOrder values must be contiguous')
const compatModuleIds = catalog.modules.filter(module => module.classification === 'feature' && module.runtime === 'compat').map(module => module.id)
assert.deepEqual([...migrationModuleIds].sort(), [...compatModuleIds].sort(), 'migration units must cover every compat feature exactly once')
const migrationTargetIds = new Set(migrationUnits.flatMap(unit => unit.targetModules as string[]))
const productModuleIdSet = new Set(productModuleIds(productManifest))
const uncoveredInactivePlugins = pluginBindings
  .filter(({ module }) => module.classification === 'feature' && module.runtime === 'inactive' && !migrationTargetIds.has(module.id))
  .map(({ module }) => module.id)
  .sort()
assert.deepEqual(uncoveredInactivePlugins, [], 'every inactive native feature plugin must belong to a migration target unit')
const uncoveredProductPlugins = pluginBindings
  .filter(({ module }) => module.classification === 'feature' && module.runtime === 'inactive' && !productModuleIdSet.has(module.id))
  .map(({ module }) => module.id)
  .sort()
assert.deepEqual(uncoveredProductPlugins, [], 'every inactive native feature plugin must belong to the long-term product composition')
assert.ok(productModuleIdSet.has('native-product-composition'), 'long-term product manifest must own its native process composition')
const nativeProductModule = catalog.modules.find(module => module.id === 'native-product-composition')
assert.ok(nativeProductModule, 'module catalog must define native-product-composition')
const expectedNativeRuntimeDependencies = [
  'dsh-runtime',
  ...productModuleIds(productManifest).filter(id => id !== nativeProductModule.id && !nativeProductModule.dependsOn.includes(id)),
].sort()
assert.deepEqual(
  [...nativeProductModule.runtimeDependsOn].sort(),
  [...new Set(expectedNativeRuntimeDependencies)].sort(),
  'native product runtime dependencies must exactly match the long-term product manifest',
)
const profileActivationEnvironment = [...new Set(profileSource.match(/QUARK_NATIVE_[A-Z_]+/g) ?? [])].sort()
assert.deepEqual([...productManifest.requiredEnvironment].sort(), profileActivationEnvironment, 'product activation environment must exactly match native Cordis gates')
for (const name of productManifest.requiredConfiguration) {
  assert.ok(profileSource.includes(name), `required product configuration ${name} is not consumed by the Cordis profile`)
}

const exitUnits = migrationPlan.exitUnits as Array<Record<string, unknown>>
const exitFields = ['afterCutoverUnits', 'afterExitUnits', 'disposition', 'id', 'modules', 'requiresMaintenanceWindow', 'rollback', 'verification']
const exitUnitIds = new Set(exitUnits.map(unit => unit.id))
assert.equal(exitUnitIds.size, exitUnits.length, 'migration exit unit ids must be unique')
const exitingMigrationModuleIds: string[] = []
for (const unit of exitUnits) {
  assert.deepEqual(Object.keys(unit).sort(), exitFields, `migration exit unit ${String(unit.id)} has unknown or missing fields`)
  assert.equal(typeof unit.id, 'string', 'migration exit unit id must be a string')
  assert.ok(Array.isArray(unit.modules) && unit.modules.length > 0 && unit.modules.every(value => typeof value === 'string'), `migration exit unit ${String(unit.id)} must contain module ids`)
  assert.equal(new Set(unit.modules as string[]).size, (unit.modules as string[]).length, `migration exit unit ${String(unit.id)} modules must be unique`)
  for (const moduleId of unit.modules as string[]) {
    const module = catalog.modules.find(item => item.id === moduleId)
    assert.ok(module, `migration exit unit ${String(unit.id)} references unknown module ${moduleId}`)
    assert.equal(module.classification, 'migration', `migration exit target ${moduleId} must be a migration module`)
  }
  assert.ok(unit.disposition === 'remove' || unit.disposition === 'reclassify-feature', `migration exit unit ${String(unit.id)} has invalid disposition`)
  assert.ok(Array.isArray(unit.afterCutoverUnits) && unit.afterCutoverUnits.every(value => typeof value === 'string'), `migration exit unit ${String(unit.id)} must define afterCutoverUnits`)
  for (const dependency of unit.afterCutoverUnits as string[]) {
    assert.ok(migrationUnitIds.has(dependency), `migration exit unit ${String(unit.id)} has unknown cutover dependency ${dependency}`)
  }
  assert.ok(Array.isArray(unit.afterExitUnits) && unit.afterExitUnits.every(value => typeof value === 'string'), `migration exit unit ${String(unit.id)} must define afterExitUnits`)
  for (const dependency of unit.afterExitUnits as string[]) {
    assert.ok(exitUnitIds.has(dependency), `migration exit unit ${String(unit.id)} has unknown exit dependency ${dependency}`)
    assert.notEqual(dependency, unit.id, `migration exit unit ${String(unit.id)} cannot depend on itself`)
  }
  assert.ok(typeof unit.verification === 'string' && unit.verification.trim(), `migration exit unit ${String(unit.id)} must define verification`)
  assert.ok(typeof unit.rollback === 'string' && unit.rollback.trim(), `migration exit unit ${String(unit.id)} must define rollback`)
  assert.equal(typeof unit.requiresMaintenanceWindow, 'boolean', `migration exit unit ${String(unit.id)} must define requiresMaintenanceWindow`)
  exitingMigrationModuleIds.push(...unit.modules as string[])
}
assertAcyclicExitUnits(exitUnits)
const catalogMigrationModuleIds = catalog.modules.filter(module => module.classification === 'migration').map(module => module.id)
assert.deepEqual([...exitingMigrationModuleIds].sort(), [...catalogMigrationModuleIds].sort(), 'migration exit units must cover every migration module exactly once')

const files = await sourceFiles(resolve(root, 'src'), '.ts')
const nativeIntervalOwners: string[] = []
const lateInjectedLookups: string[] = []
const missingClassInjects: string[] = []
const injectedPortPattern = /\bctx\.(agents|llm|subagents|quarkState|quarkWorkflows|quarkEvents|quarkActionLedger|quarkExecutors)\b/g
for (const file of files) {
  const source = await readFile(file, 'utf8')
  if (source.includes('setInterval(')) nativeIntervalOwners.push(relative(root, file))
  for (const match of source.matchAll(/this\.ctx\.(?!parallel\b|logger\b|emit\b|on\b|effect\b)([A-Za-z_$][\w$]*)/g)) {
    lateInjectedLookups.push(`${relative(root, file)}:${match[1]}`)
  }
  if (/\bclass\s+\w+\s+extends\s+Service\b/.test(source)) {
    const accessed = new Set([...source.matchAll(injectedPortPattern)].map(match => match[1]!))
    const declared = new Set((/static\s+inject\s*=\s*\[([^\]]*)\]/s.exec(source)?.[1] ?? '')
      .match(/[A-Za-z_$][\w$]*/g) ?? [])
    for (const name of accessed) if (!declared.has(name)) missingClassInjects.push(`${relative(root, file)}:${name}`)
  }
}
assert.deepEqual(nativeIntervalOwners.sort(), ['src/runtime/wake-scheduler.ts'], 'native feature code must use durable workflows or the shared recovery scheduler instead of private intervals')
assert.deepEqual(lateInjectedLookups, [], 'long-lived services must capture injected ports during construction instead of resolving them through this.ctx later')
assert.deepEqual(missingClassInjects, [], 'Cordis Service classes must declare every injected port they resolve during construction')
const compatibilityFiles = await sourceFiles(resolve(root, 'packages/bridge-compat/src'), '.js')
const operationalFiles = [
  ...await sourceFiles(resolve(root, 'scripts'), '.ts'),
  ...await sourceFiles(resolve(root, 'scripts'), '.mjs'),
]
validateSourceOwnership(catalog, [...files, ...compatibilityFiles, ...operationalFiles].map(filename => relative(root, filename)))
const runtimeAssets = trackedRuntimeAssets(root)
validateAssetOwnership(catalog, runtimeAssets)
const moduleById = new Map(catalog.modules.map(module => [module.id, module]))
const ownerBySource = new Map(catalog.modules.flatMap(module => module.owns.map(source => [source, module.id] as const)))
const actualDependencies = new Map(catalog.modules.map(module => [module.id, new Set<string>()]))
const dshSourceModules = new Set<string>()
const injectedRuntimeRequirements = new Map<string, Set<string>>()
const forbiddenSkeletonSemantics = /im\.message\.receive_v1|card\.action\.trigger|claude-code|dsh-native|\b(?:feishu|lark|dida|ticktick|blacklake|xiaowei|claude|codex|openai|takeover|nativecutover)\b|常东旭|任永强|张以宁/gi
const violations: string[] = []
for (const module of catalog.modules.filter(item => item.layer === 'contract')) {
  for (const filename of module.owns) {
    const source = await readFile(resolve(root, filename), 'utf8')
    if (/\b(?:export\s+)?class\s+[A-Za-z_$][\w$]*/.test(source)) {
      violations.push(`contract module ${module.id} declares a class implementation in ${filename}`)
    }
  }
}
for (const filename of files) {
  const source = await readFile(filename, 'utf8')
  const from = relative(root, filename)
  const owner = ownerBySource.get(from)
  const ownerModule = moduleById.get(owner ?? '')
  const importsDshRuntime = /^import\s+(?!type\b)[^\n]*from\s+['"]@deepseek-ai\/(?:cordis|dsh-)/m.test(source)
  const definesCordisPlugin = /from\s+['"]@deepseek-ai\/cordis['"]/.test(source)
    && /(?:\bextends\s+Service\b|\bexport\s+(?:async\s+)?function\s+apply\s*\()/.test(source)
  if (owner && (importsDshRuntime || definesCordisPlugin)) dshSourceModules.add(owner)
  if (ownerModule?.classification === 'skeleton') {
    const productTerms = [...new Set([...source.matchAll(forbiddenSkeletonSemantics)].map(match => match[0]!.toLowerCase()))]
    if (productTerms.length) violations.push(`${from} puts product semantics in the skeleton: ${productTerms.join(', ')}`)
  }
  if (ownerModule?.classification === 'feature') {
    const required = injectedRuntimeRequirements.get(ownerModule.id) ?? new Set<string>()
    if (/\bquarkWorkflows\b/.test(source)) required.add('durable-workflow-runtime')
    if (/\bquarkEvents\b/.test(source)) required.add('durable-event-runtime')
    if (/\bquarkActionLedger\b/.test(source)) required.add('durable-action-ledger')
    injectedRuntimeRequirements.set(ownerModule.id, required)
  }
  if (ownerModule?.layer === 'contract'
    && /(?:\bextends\s+Service\b|\bexport\s+(?:async\s+)?function\s+apply\s*\()/.test(source)) {
    violations.push(`${from} is executable plugin/service code owned by contract module ${ownerModule.id}`)
  }
  if (ownerModule?.layer === 'contract' && /from\s+['"]node:/.test(source)) {
    violations.push(`${from} imports a Node runtime API inside contract module ${ownerModule.id}`)
  }
  if ((ownerModule?.id === 'policy-contracts' || ownerModule?.id === 'policy-runtime')
    && /(channel\.chatType|message\.mentionsOwner|settleMinutes|urgentSuppressedCount)/.test(source)) {
    violations.push(`${from} hard-codes product policy vocabulary inside skeleton module ${ownerModule.id}`)
  }
  if (startsWithAny(from, ['src/storage/sqlite.ts', 'src/storage/postgres.ts', 'src/storage/service.ts'])
    && /(eventToPolicySample|recentPolicySamples|message\.received)/.test(source)) {
    violations.push(`${from} interprets assistant policy semantics inside a replaceable storage provider`)
  }
  if (from.startsWith('src/bootstrap/') && /\b(?:interface|type)\s+[A-Za-z0-9_]*ApplicationConfig\b/.test(source)) {
    violations.push(`${from} defines an aggregate application config; configuration must stay with the owning module`)
  }
  if (/\bAssistantStore\b/.test(source) && !startsWithAny(from, [
    'src/storage/types.ts', 'src/storage/factory.ts', 'src/storage/service.ts',
    'src/storage/sqlite.ts', 'src/storage/postgres.ts',
  ])) {
    violations.push(`${from} depends on the aggregate AssistantStore instead of a narrow capability port`)
  }
  if (from === 'src/execution/router.ts' && /(claude-code|\bcodex\b|dsh-native)/i.test(source)) {
    violations.push(`${from} hard-codes an executor route instead of reading composition config`)
  }
  if (/from\s+['"]node:child_process['"]/.test(source)
    && ownerModule?.layer !== 'adapter'
    && !startsWithAny(from, ['src/runtime/kernel', 'src/runtime/compat'])) {
    violations.push(`${from} invokes child_process outside an adapter or supervised runtime boundary`)
  }
  for (const specifier of relativeImports(source)) {
    const target = resolve(dirname(filename), specifier).replace(/\.js$/, '.ts')
    const to = relative(root, target)
    const fromOwner = ownerBySource.get(from)
    const toOwner = ownerBySource.get(to)
    if (fromOwner && toOwner && fromOwner !== toOwner) actualDependencies.get(fromOwner)?.add(toOwner)
    if (fromOwner && toOwner && fromOwner !== toOwner && !moduleById.get(fromOwner)?.dependsOn.includes(toOwner)) {
      violations.push(`${from} (${fromOwner}) imports ${to} (${toOwner}) without declaring the module dependency`)
    }
    if (ownerModule?.classification === 'feature'
      && ['durable-workflow-runtime', 'durable-event-runtime', 'durable-action-ledger'].includes(toOwner ?? '')) {
      violations.push(`${from} imports runtime implementation ${to}; features must source-depend on its stable contract port`)
    }
    if (from.startsWith('src/platform/') && from !== 'src/platform/index.ts' && outside(to, ['src/platform/'])) {
      violations.push(`${from} imports ${to}; platform skeleton must not depend on implementation layers`)
    }
    if (from === 'src/platform/index.ts' && outside(to, [
      'src/platform/', 'src/domain/contracts', 'src/domain/authorization', 'src/storage/types', 'src/storage/ports', 'src/storage/service-contract',
      'src/policy/types', 'src/execution/workspace-policy', 'src/execution/ledger-contract', 'src/events/contracts', 'src/workflow/contracts',
    ])) {
      violations.push(`${from} exports non-contract implementation ${to}`)
    }
    if (from.startsWith('src/domain/') && outside(to, ['src/domain/'])) {
      violations.push(`${from} imports ${to}; domain contracts must remain dependency-free`)
    }
    if (startsWithAny(from, ['src/storage/', 'src/policy/', 'src/execution/'])
      && startsWithAny(to, ['src/lark/', 'src/blacklake/', 'src/runtime/compat', 'src/migration/', 'src/web/', 'src/bootstrap/'])) {
      violations.push(`${from} imports upper or migration layer ${to}`)
    }
    if (from.startsWith('src/web/') && startsWithAny(to, ['src/lark/', 'src/blacklake/', 'src/runtime/', 'src/migration/', 'src/config/feature-parity'])) {
      violations.push(`${from} imports feature or migration implementation ${to}`)
    }
    if (to === 'src/runtime/compat.ts' && from !== 'src/runtime/compat-composition.ts') {
      violations.push(`${from} imports compatibility runtime outside the composition root`)
    }
  }
}
const neutralRuntime = new ControlOnlyRuntime().snapshot()
assert.equal(neutralRuntime.mode, 'control-only', 'neutral runtime must identify itself as control-only')
assert.equal(neutralRuntime.operationalMode, 'control-only', 'neutral runtime must not carry migration or product semantics')
for (const module of catalog.modules) {
  const actual = [...(actualDependencies.get(module.id) ?? [])].sort()
  const declared = [...module.dependsOn].sort()
  if (JSON.stringify(actual) !== JSON.stringify(declared)) {
    violations.push(`module ${module.id} source dependencies differ: declared=[${declared.join(',')}] actual=[${actual.join(',')}]`)
  }
  if (dshSourceModules.has(module.id) && module.id !== 'dsh-runtime' && !module.runtimeDependsOn.includes('dsh-runtime')) {
    violations.push(`module ${module.id} imports the DSH/Cordis runtime without runtimeDependsOn=dsh-runtime`)
  }
  for (const runtimeDependency of injectedRuntimeRequirements.get(module.id) ?? []) {
    if (!module.runtimeDependsOn.includes(runtimeDependency)) {
      violations.push(`feature module ${module.id} injects ${runtimeDependency} without declaring the runtime dependency`)
    }
  }
}
assert.deepEqual(violations, [], `architecture dependency violations:\n${violations.join('\n')}`)
const summary = summarizeModules(catalog)
const effectCoverage = analyzeEffectCoverage(catalog)
process.stdout.write(`Architecture verified modules=${summary.total} skeleton=${summary.classification.skeleton} features=${summary.classification.feature} migration=${summary.classification.migration} ready=${summary.implementation.ready} static=${summary.runtime.static} active=${summary.runtime.active} compat=${summary.runtime.compat} plugins=${pluginBindings.length} assets=${runtimeAssets.length} cutoverUnits=${migrationUnits.length} exitUnits=${exitUnits.length} effectsImplemented=${effectCoverage.implemented.length}/${effectCoverage.required.length} effectsActive=${effectCoverage.active.length}/${effectCoverage.required.length}\n`)

function trackedRuntimeAssets(projectRoot: string): string[] {
  const paths = [
    '.env.example', 'Dockerfile', 'compose.yaml', 'compose.postgres.yaml', 'cordis.patch.yml',
    'compat', 'config', 'deploy', 'migrations', 'web', 'templates',
    'packages/bridge-compat/config.example.json', 'packages/bridge-compat/schemas',
  ]
  const output = execFileSync('git', ['ls-files', '-z', '--', ...paths], { cwd: projectRoot, encoding: 'utf8' })
  return output.split('\0').filter(Boolean).sort()
}

async function sourceFiles(directory: string, extension: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(path, extension))
    else if (entry.isFile() && entry.name.endsWith(extension)) result.push(path)
  }
  return result
}

function assertAcyclicCutovers(units: readonly Record<string, unknown>[]): void {
  const dependencies = new Map(units.map(unit => [String(unit.id), unit.cutoverAfter as string[]]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) throw new Error(`migration cutover cycle: ${[...path, id].join(' -> ')}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) visit(dependency, [...path, id])
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of dependencies.keys()) visit(id, [])
}

function assertAcyclicExitUnits(units: readonly Record<string, unknown>[]): void {
  const dependencies = new Map(units.map(unit => [String(unit.id), unit.afterExitUnits as string[]]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) throw new Error(`migration exit cycle: ${[...path, id].join(' -> ')}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) visit(dependency, [...path, id])
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of dependencies.keys()) visit(id, [])
}

function relativeImports(source: string): string[] {
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g)]
    .flatMap(match => match[1] ? [match[1]] : [])
}

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => value.startsWith(prefix))
}

function outside(value: string, allowed: readonly string[]): boolean {
  return value.startsWith('src/') && !startsWithAny(value, allowed)
}

function cordisPlugins(source: string): Map<string, { readonly name: string; readonly block: string }> {
  const result = new Map<string, { readonly name: string; readonly block: string }>()
  let current: { id: string; lines: string[]; name?: string } | undefined
  const flush = (): void => {
    if (!current?.name) return
    assert.ok(!result.has(current.id), `duplicate Cordis plugin id ${current.id}`)
    result.set(current.id, { name: current.name, block: current.lines.join('\n') })
  }
  for (const line of source.split(/\r?\n/)) {
    const id = line.match(/^\s*-\s+id:\s*([^\s#]+)\s*(?:#.*)?$/)?.[1]
    if (id) {
      flush()
      current = { id: unquote(id), lines: [line] }
      continue
    }
    current?.lines.push(line)
    const name = line.match(/^\s+name:\s*([^\s#]+)\s*(?:#.*)?$/)?.[1]
    if (name && current) current.name = unquote(name)
  }
  flush()
  return result
}

function cordisPatchEntries(source: string): Map<string, string> {
  const result = new Map<string, string>()
  let current: { id: string; lines: string[] } | undefined
  const flush = (): void => {
    if (!current) return
    assert.ok(!result.has(current.id), `duplicate Cordis patch id ${current.id}`)
    result.set(current.id, current.lines.join('\n'))
  }
  for (const line of source.split(/\r?\n/)) {
    const id = line.match(/^\s*-\s+id:\s*([^\s#]+)\s*(?:#.*)?$/)?.[1]
    if (id) {
      flush()
      current = { id: unquote(id), lines: [line] }
      continue
    }
    current?.lines.push(line)
  }
  flush()
  return result
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertPackageExportOwned(value: unknown, moduleId: string, ownedSources: readonly string[]): void {
  assert.ok(isRecord(value), `package export for ${moduleId} must be an object`)
  const importTarget = value.import
  const typesTarget = value.types
  assert.equal(typeof importTarget, 'string', `package export for ${moduleId} must define import`)
  assert.equal(typeof typesTarget, 'string', `package export for ${moduleId} must define types`)
  const importSource = String(importTarget).replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')
  const typesSource = String(typesTarget).replace(/^\.\/dist\//, 'src/').replace(/\.d\.ts$/, '.ts')
  assert.ok(ownedSources.includes(importSource), `package export for ${moduleId} points outside its source ownership: ${String(importTarget)}`)
  assert.equal(typesSource, importSource, `package export for ${moduleId} import/types targets diverge`)
}
