import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { analyzeEffectCoverage, loadModuleCatalog, summarizeModules, validateSourceOwnership } from '../src/platform/modules.js'

const root = process.cwd()
const catalog = await loadModuleCatalog()
for (const module of catalog.modules) await access(resolve(root, module.source))
const migrationPlan = JSON.parse(await readFile(resolve(root, 'config/native-migration-plan.json'), 'utf8')) as {
  version?: unknown
  sourceRuntime?: unknown
  units?: unknown
}
assert.equal(migrationPlan.version, 1, 'native migration plan must be version 1')
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
const violations: string[] = []
for (const filename of files) {
  const source = await readFile(filename, 'utf8')
  const from = relative(root, filename)
  if (startsWithAny(from, ['src/domain/', 'src/storage/'])
    && /(im\.message\.receive_v1|card\.action\.trigger|claude-code|dsh-native|\bfeishu\b|\blark\b)/i.test(source)) {
    violations.push(`${from} hard-codes a feature adapter identity inside the skeleton`)
  }
  if (from === 'src/execution/router.ts' && /(claude-code|\bcodex\b|dsh-native)/i.test(source)) {
    violations.push(`${from} hard-codes an executor route instead of reading composition config`)
  }
  const owner = ownerBySource.get(from)
  if (/from\s+['"]node:child_process['"]/.test(source)
    && moduleById.get(owner ?? '')?.layer !== 'adapter'
    && !startsWithAny(from, ['src/runtime/kernel', 'src/runtime/compat'])) {
    violations.push(`${from} invokes child_process outside an adapter or supervised runtime boundary`)
  }
  for (const specifier of relativeImports(source)) {
    const target = resolve(dirname(filename), specifier).replace(/\.js$/, '.ts')
    const to = relative(root, target)
    const fromOwner = ownerBySource.get(from)
    const toOwner = ownerBySource.get(to)
    if (fromOwner && toOwner && fromOwner !== toOwner && !moduleById.get(fromOwner)?.dependsOn.includes(toOwner)) {
      violations.push(`${from} (${fromOwner}) imports ${to} (${toOwner}) without declaring the module dependency`)
    }
    if (from.startsWith('src/platform/') && from !== 'src/platform/index.ts' && outside(to, ['src/platform/'])) {
      violations.push(`${from} imports ${to}; platform skeleton must not depend on implementation layers`)
    }
    if (from === 'src/platform/index.ts' && outside(to, [
      'src/platform/', 'src/domain/contracts', 'src/domain/authorization', 'src/storage/types', 'src/policy/types', 'src/execution/workspace-policy',
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
    if (to.startsWith('src/runtime/compat') && from !== 'src/bootstrap/application.ts') {
      violations.push(`${from} imports compatibility runtime outside the composition root`)
    }
  }
}
assert.deepEqual(violations, [], `architecture dependency violations:\n${violations.join('\n')}`)
const summary = summarizeModules(catalog)
const effectCoverage = analyzeEffectCoverage(catalog)
process.stdout.write(`Architecture verified modules=${summary.total} skeleton=${summary.classification.skeleton} features=${summary.classification.feature} migration=${summary.classification.migration} ready=${summary.implementation.ready} active=${summary.runtime.active} compat=${summary.runtime.compat} cutoverUnits=${migrationUnits.length} effectsImplemented=${effectCoverage.implemented.length}/${effectCoverage.required.length} effectsActive=${effectCoverage.active.length}/${effectCoverage.required.length}\n`)

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
