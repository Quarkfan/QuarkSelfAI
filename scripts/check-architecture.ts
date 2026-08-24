import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { analyzeEffectCoverage, loadModuleCatalog, summarizeModules, validateSourceOwnership } from '../src/platform/modules.js'

const root = process.cwd()
const catalog = await loadModuleCatalog()
for (const module of catalog.modules) await access(resolve(root, module.source))
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  name?: unknown
  exports?: unknown
}
const packageName = typeof packageManifest.name === 'string' ? packageManifest.name : ''
assert.ok(packageName, 'package.json must define a package name')
assert.ok(isRecord(packageManifest.exports), 'package.json must define exports')
const profileSource = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
const platformApiSource = await readFile(resolve(root, 'src/platform/index.ts'), 'utf8')
const storagePortsSource = await readFile(resolve(root, 'src/storage/ports.ts'), 'utf8')
assert.ok(!platformApiSource.includes("export type * from '../storage/types.js'"), 'platform API must export the intentional storage port surface')
assert.ok(!/\b(?:AssistantStore|StorageConfig)\b/.test(storagePortsSource), 'public storage ports must not expose provider aggregate or configuration')
const profilePlugins = cordisPlugins(profileSource)
const pluginBindings = catalog.modules.flatMap(module => module.plugin ? [{ module, plugin: module.plugin }] : [])
for (const { module, plugin } of pluginBindings) {
  assert.ok(plugin.packageExport in packageManifest.exports, `module ${module.id} references missing package export ${plugin.packageExport}`)
  const expectedPackage = plugin.packageExport === '.' ? packageName : `${packageName}/${plugin.packageExport.slice(2)}`
  const mounted = profilePlugins.get(plugin.profileId)
  assert.equal(mounted?.name, expectedPackage, `module ${module.id} plugin binding differs from cordis.patch.yml`)
  const compatibilityGated = /disabled:[\s\S]*ASSISTANT_RUNTIME[^\n]*compat/.test(mounted?.block ?? '')
  if (module.runtime === 'inactive') {
    assert.ok(compatibilityGated, `inactive module ${module.id} must be compatibility-gated in cordis.patch.yml`)
  }
  if (module.runtime === 'active' || module.runtime === 'shadow') {
    assert.ok(!compatibilityGated, `${module.runtime} module ${module.id} cannot be compatibility-gated in cordis.patch.yml`)
  }
}
const boundProfileIds = new Set(pluginBindings.map(binding => binding.plugin.profileId))
for (const [profileId, mounted] of profilePlugins) {
  if (mounted.name === packageName || mounted.name.startsWith(`${packageName}/`)) {
    assert.ok(boundProfileIds.has(profileId), `local Cordis plugin ${profileId} is not owned by a module catalog binding`)
  }
}
const profileCompositions = catalog.modules.filter(module => module.source === 'cordis.patch.yml')
assert.equal(profileCompositions.length, 1, 'the bundled Cordis profile must have exactly one catalog owner')
const profileComposition = profileCompositions[0]!
const compatibilityAwareProfile = /ASSISTANT_RUNTIME[^\n]*compat/.test(profileSource)
assert.equal(profileComposition.classification, compatibilityAwareProfile ? 'migration' : 'feature', 'Cordis profile classification must reflect compatibility awareness')
assert.ok(profileComposition.runtimeDependsOn.includes('dsh-runtime'), 'the Cordis profile composition must depend on the DSH runtime')
for (const { module } of pluginBindings) {
  assert.ok(profileComposition.runtimeDependsOn.includes(module.id), `Cordis profile composition does not declare plugin module ${module.id}`)
}
const migrationPlan = JSON.parse(await readFile(resolve(root, 'config/native-migration-plan.json'), 'utf8')) as {
  version?: unknown
  sourceRuntime?: unknown
  units?: unknown
}
assert.equal(migrationPlan.version, 2, 'native migration plan must be version 2')
assert.equal(migrationPlan.sourceRuntime, 'bridge-compat-host', 'native migration plan must identify the compatibility host')
assert.ok(Array.isArray(migrationPlan.units), 'native migration plan must contain units')
const migrationUnits = migrationPlan.units as Array<Record<string, unknown>>
const migrationModuleIds: string[] = []
const migrationUnitIds = new Set(migrationUnits.map(unit => unit.id))
assert.equal(migrationUnitIds.size, migrationUnits.length, 'migration unit ids must be unique')
const buildOrders = new Set<number>()
for (const unit of migrationUnits) {
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

const files = await sourceFiles(resolve(root, 'src'))
validateSourceOwnership(catalog, files.map(filename => relative(root, filename)))
const moduleById = new Map(catalog.modules.map(module => [module.id, module]))
const ownerBySource = new Map(catalog.modules.flatMap(module => module.owns.map(source => [source, module.id] as const)))
const actualDependencies = new Map(catalog.modules.map(module => [module.id, new Set<string>()]))
const dshSourceModules = new Set<string>()
const violations: string[] = []
for (const filename of files) {
  const source = await readFile(filename, 'utf8')
  const from = relative(root, filename)
  const owner = ownerBySource.get(from)
  const ownerModule = moduleById.get(owner ?? '')
  if (owner && /@deepseek-ai\/(?:cordis|dsh-)/.test(source)) dshSourceModules.add(owner)
  if (ownerModule?.classification === 'skeleton'
    && /(im\.message\.receive_v1|card\.action\.trigger|claude-code|dsh-native|\b(?:feishu|lark|dida|ticktick|blacklake|codex|claude|xiaowei|takeover|nativecutover)\b|常东旭|任永强|张以宁)/i.test(source)) {
    violations.push(`${from} hard-codes a feature or migration identity inside skeleton module ${ownerModule.id}`)
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
    if (from.startsWith('src/platform/') && from !== 'src/platform/index.ts' && outside(to, ['src/platform/'])) {
      violations.push(`${from} imports ${to}; platform skeleton must not depend on implementation layers`)
    }
    if (from === 'src/platform/index.ts' && outside(to, [
      'src/platform/', 'src/domain/contracts', 'src/domain/authorization', 'src/storage/types', 'src/storage/ports', 'src/storage/service-contract', 'src/policy/types', 'src/execution/workspace-policy',
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
for (const module of catalog.modules) {
  const actual = [...(actualDependencies.get(module.id) ?? [])].sort()
  const declared = [...module.dependsOn].sort()
  if (JSON.stringify(actual) !== JSON.stringify(declared)) {
    violations.push(`module ${module.id} source dependencies differ: declared=[${declared.join(',')}] actual=[${actual.join(',')}]`)
  }
  if (dshSourceModules.has(module.id) && module.id !== 'dsh-runtime' && !module.runtimeDependsOn.includes('dsh-runtime')) {
    violations.push(`module ${module.id} imports the DSH/Cordis runtime without runtimeDependsOn=dsh-runtime`)
  }
}
assert.deepEqual(violations, [], `architecture dependency violations:\n${violations.join('\n')}`)
const summary = summarizeModules(catalog)
const effectCoverage = analyzeEffectCoverage(catalog)
process.stdout.write(`Architecture verified modules=${summary.total} skeleton=${summary.classification.skeleton} features=${summary.classification.feature} migration=${summary.classification.migration} ready=${summary.implementation.ready} active=${summary.runtime.active} compat=${summary.runtime.compat} plugins=${pluginBindings.length} cutoverUnits=${migrationUnits.length} effectsImplemented=${effectCoverage.implemented.length}/${effectCoverage.required.length} effectsActive=${effectCoverage.active.length}/${effectCoverage.required.length}\n`)

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(path)
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

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
