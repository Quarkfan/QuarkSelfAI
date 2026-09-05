import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Catalog = { modules: Array<{ id: string }> }
type Migration = {
  status: string
  rules: { exactlyOnce: boolean; coreMayDependOnPrivatePack: boolean; activationAllowed: boolean; runtimeCompositionChangeAllowed: boolean }
  groups: Array<{ disposition: string; targetPlane: string; moduleIds: string[] }>
}
type Coverage = {
  status: string
  poc: string
  requiredCoverage: string[]
  requirements: Array<Record<string, string>>
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const allowedDispositions = new Set(['platform-core', 'capability-artifact', 'private-work-integration', 'experience-artifact', 'operations-capability', 'migration-only'])

export async function auditCapabilityPlatformDesign(rootInput = projectRoot) {
  const root = resolve(rootInput)
  const catalog = JSON.parse(await readFile(resolve(root, 'config/module-catalog.json'), 'utf8')) as Catalog
  const migration = JSON.parse(await readFile(resolve(root, 'config/capability-platform-migration.json'), 'utf8')) as Migration
  const coverage = JSON.parse(await readFile(resolve(root, 'config/capability-platform-console-coverage.json'), 'utf8')) as Coverage
  const poc = await readFile(resolve(root, coverage.poc), 'utf8')
  const prd = await readFile(resolve(root, 'docs/product/capability-platform-prd.md'), 'utf8')
  const adr = await readFile(resolve(root, 'docs/adr/0092-cloud-control-local-execution-capability-platform.md'), 'utf8')
  const blockers: string[] = []

  const catalogIds = catalog.modules.map(item => item.id)
  const migratedIds = migration.groups.flatMap(group => group.moduleIds)
  const seen = new Set<string>()
  const duplicates = migratedIds.filter(id => {
    if (seen.has(id)) return true
    seen.add(id)
    return false
  })
  const missing = catalogIds.filter(id => !migratedIds.includes(id))
  const unknown = migratedIds.filter(id => !catalogIds.includes(id))
  if (duplicates.length) blockers.push(`duplicate-module-disposition:${[...new Set(duplicates)].join(',')}`)
  if (missing.length) blockers.push(`missing-module-disposition:${missing.join(',')}`)
  if (unknown.length) blockers.push(`unknown-module-disposition:${unknown.join(',')}`)
  if (migration.groups.some(group => !allowedDispositions.has(group.disposition) || !group.targetPlane || !group.moduleIds.length)) blockers.push('invalid-migration-group')
  if (!migration.status.endsWith('-inactive') || migration.rules.exactlyOnce !== true || migration.rules.coreMayDependOnPrivatePack !== false || migration.rules.activationAllowed !== false || migration.rules.runtimeCompositionChangeAllowed !== false) blockers.push('unsafe-migration-design-state')

  const required = new Set(coverage.requiredCoverage)
  const requirementIds = new Set<string>()
  let complete = 0
  for (const item of coverage.requirements) {
    if (!item.id || requirementIds.has(item.id)) blockers.push(`invalid-coverage-id:${item.id ?? 'missing'}`)
    requirementIds.add(item.id)
    const missingFields = [...required].filter(field => !item[field]?.trim())
    if (!item.domain || !item.label || !item.screen || !item.anchor || missingFields.length) blockers.push(`incomplete-console-coverage:${item.id}`)
    else {
      const anchor = `data-coverage="${item.anchor}"`
      const anchorCount = poc.split(anchor).length - 1
      if (anchorCount !== 1) blockers.push(`${anchorCount === 0 ? 'missing' : 'duplicate'}-poc-anchor:${item.id}:${item.anchor}`)
      else if (!poc.includes(`id="page-${item.screen}"`)) blockers.push(`missing-poc-screen:${item.id}:${item.screen}`)
      else complete += 1
    }
  }
  const coveragePercent = coverage.requirements.length ? Math.round((complete / coverage.requirements.length) * 10000) / 100 : 0
  if (coverage.status !== 'design-candidate-inactive') blockers.push('unsafe-console-coverage-state')
  if (coveragePercent !== 100) blockers.push(`console-coverage-not-complete:${coveragePercent}`)
  if (!poc.includes(`POC requirement anchors</span><b>${coverage.requirements.length} / ${coverage.requirements.length}</b>`)) blockers.push('poc-visible-coverage-count-drift')
  if (!prd.includes('Capability Artifact') || !prd.includes('Agent Blueprint') || !prd.includes('Execution Envelope')) blockers.push('prd-missing-core-abstractions')
  if (!adr.includes('Proposed / inactive') || !poc.includes('所有写入关闭')) blockers.push('inactive-design-safety-marker-missing')

  return {
    ok: blockers.length === 0,
    blockers,
    moduleCatalogCount: catalogIds.length,
    migratedModuleCount: migratedIds.length,
    dispositionCounts: Object.fromEntries(migration.groups.map(group => [group.disposition, migratedIds.filter(id => migration.groups.some(candidate => candidate.disposition === group.disposition && candidate.moduleIds.includes(id))).length])),
    consoleRequirementCount: coverage.requirements.length,
    consoleCompleteCount: complete,
    consoleCoveragePercent: coveragePercent,
    runtimeActivationAllowed: migration.rules.activationAllowed,
    runtimeCompositionChangeAllowed: migration.rules.runtimeCompositionChangeAllowed,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = await auditCapabilityPlatformDesign()
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}
