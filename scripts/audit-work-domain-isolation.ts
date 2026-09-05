import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type ClassificationRule = {
  id: string
  disposition: 'private-pack' | 'genericize' | 'redact-or-retire'
  exact?: string[]
  prefixes?: string[]
}

type IsolationConfig = {
  schemaVersion: 1
  projectId: 'quarkselfai'
  status: 'migration-inventory'
  markers: string[]
  excludedRegistryPaths: string[]
  baseline: {
    pathCount: number
    pathDigest: string
    evidenceDigest: string
  }
  classificationRules: ClassificationRule[]
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function markerExpression(markers: string[]): RegExp {
  if (markers.length === 0 || markers.some(marker => !marker || marker.length > 80 || /[\r\n\0]/.test(marker))) {
    throw new Error('work-domain marker inventory is invalid')
  }
  const escaped = markers.map(marker => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(escaped.join('|'), 'i')
}

function validateConfig(value: unknown): IsolationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('work-domain isolation config is invalid')
  const config = value as Partial<IsolationConfig>
  if (config.schemaVersion !== 1 || config.projectId !== 'quarkselfai' || config.status !== 'migration-inventory'
    || !Array.isArray(config.markers) || !Array.isArray(config.excludedRegistryPaths)
    || !config.baseline || !Array.isArray(config.classificationRules)) {
    throw new Error('work-domain isolation config is invalid')
  }
  if (!Number.isSafeInteger(config.baseline.pathCount) || config.baseline.pathCount < 0
    || !/^[0-9a-f]{64}$/.test(config.baseline.pathDigest)
    || !/^[0-9a-f]{64}$/.test(config.baseline.evidenceDigest)) {
    throw new Error('work-domain isolation baseline is invalid')
  }
  const ids = new Set<string>()
  for (const rule of config.classificationRules) {
    if (!rule || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(rule.id) || ids.has(rule.id)
      || !['private-pack', 'genericize', 'redact-or-retire'].includes(rule.disposition)
      || (!rule.exact?.length && !rule.prefixes?.length)) {
      throw new Error('work-domain isolation classification rule is invalid')
    }
    ids.add(rule.id)
  }
  markerExpression(config.markers)
  return config as IsolationConfig
}

function trackedPaths(root: string): string[] {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).sort()
}

function matchingRules(path: string, rules: ClassificationRule[]): ClassificationRule[] {
  return rules.filter(rule => rule.exact?.includes(path) || rule.prefixes?.some(prefix => path.startsWith(prefix)))
}

export function computeWorkDomainInventory(root: string, configValue: unknown) {
  const config = validateConfig(configValue)
  const expression = markerExpression(config.markers)
  const excluded = new Set(config.excludedRegistryPaths)
  const findings: Array<{ path: string; evidenceLines: string[]; classification?: string; disposition?: string }> = []
  for (const path of trackedPaths(root)) {
    if (excluded.has(path)) continue
    const absolute = resolve(root, path)
    const info = lstatSync(absolute)
    if (!info.isFile() || info.isSymbolicLink()) continue
    const content = readFileSync(absolute)
    if (content.includes(0)) continue
    const evidenceLines = content.toString('utf8').split(/\r?\n/)
      .filter(line => expression.test(line)).map(line => line.trim())
    if (evidenceLines.length === 0) continue
    const rules = matchingRules(path, config.classificationRules)
    findings.push({
      path,
      evidenceLines,
      ...(rules.length === 1 ? { classification: rules[0].id, disposition: rules[0].disposition } : {}),
    })
  }
  const paths = findings.map(item => item.path)
  const evidence = findings.map(item => `${item.path}\0${item.evidenceLines.join('\n')}`).join('\0\0')
  const pathDigest = sha256(`${paths.join('\n')}\n`)
  const evidenceDigest = sha256(evidence)
  const unclassified = findings.filter(item => !item.classification).map(item => item.path)
  const ambiguous = findings.filter(item => matchingRules(item.path, config.classificationRules).length > 1).map(item => item.path)
  const counts = Object.fromEntries(config.classificationRules.map(rule => [
    rule.id,
    findings.filter(item => item.classification === rule.id).length,
  ]))
  const drift = {
    pathCount: paths.length !== config.baseline.pathCount,
    pathDigest: pathDigest !== config.baseline.pathDigest,
    evidenceDigest: evidenceDigest !== config.baseline.evidenceDigest,
  }
  return {
    ok: unclassified.length === 0 && ambiguous.length === 0 && !Object.values(drift).some(Boolean),
    status: config.status,
    pathCount: paths.length,
    pathDigest,
    evidenceDigest,
    counts,
    unclassified,
    ambiguous,
    drift,
    note: 'Only tracked text and normalized matching lines are hashed; business content and matched text are not emitted.',
  }
}

export function auditWorkDomainIsolation(root = projectRoot) {
  const config = JSON.parse(readFileSync(resolve(root, 'config/work-domain-isolation.json'), 'utf8'))
  return computeWorkDomainInventory(root, config)
}

async function main(): Promise<void> {
  const report = auditWorkDomainIsolation()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
