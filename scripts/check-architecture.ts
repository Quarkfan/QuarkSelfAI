import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { loadModuleCatalog, summarizeModules } from '../src/platform/modules.js'

const root = process.cwd()
const catalog = await loadModuleCatalog()
for (const module of catalog.modules) await access(resolve(root, module.source))

const files = await sourceFiles(resolve(root, 'src'))
const violations: string[] = []
for (const filename of files) {
  const source = await readFile(filename, 'utf8')
  const from = relative(root, filename)
  if (/from\s+['"]node:child_process['"]/.test(source)
    && !startsWithAny(from, ['src/lark/', 'src/runtime/kernel', 'src/runtime/compat'])) {
    violations.push(`${from} invokes child_process outside an adapter or supervised runtime boundary`)
  }
  for (const specifier of relativeImports(source)) {
    const target = resolve(dirname(filename), specifier).replace(/\.js$/, '.ts')
    const to = relative(root, target)
    if (from.startsWith('src/platform/') && from !== 'src/platform/index.ts' && outside(to, ['src/platform/'])) {
      violations.push(`${from} imports ${to}; platform skeleton must not depend on implementation layers`)
    }
    if (from === 'src/platform/index.ts' && outside(to, [
      'src/platform/', 'src/domain/contracts', 'src/storage/types', 'src/policy/types', 'src/execution/workspace-policy',
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
    if (from.startsWith('src/web/') && startsWithAny(to, ['src/lark/', 'src/blacklake/', 'src/runtime/compat', 'src/migration/'])) {
      violations.push(`${from} imports feature or migration implementation ${to}`)
    }
    if (to.startsWith('src/runtime/compat') && from !== 'src/bootstrap/application.ts') {
      violations.push(`${from} imports compatibility runtime outside the composition root`)
    }
  }
}
assert.deepEqual(violations, [], `architecture dependency violations:\n${violations.join('\n')}`)
const summary = summarizeModules(catalog)
process.stdout.write(`Architecture verified modules=${catalog.modules.length} skeleton=${summary.skeleton.native} featureNative=${summary.feature.native} featureCompat=${summary.feature.compat} migration=${summary.migration.native}\n`)

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(path)
  }
  return result
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
