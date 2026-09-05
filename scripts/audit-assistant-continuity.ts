import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type ContinuityInventory = {
  schemaVersion: number
  projectId: string
  scope: string
  instructionContract: {
    primary: string
    mirrors: string[]
    requiredTracked: boolean
    mustMatchByteForByte: boolean
  }
  repositorySources: string[]
  durableCapabilities: Array<{
    id: string
    recoveryArtifactIds: string[]
    requirement: string
  }>
  deviceBoundInputs: Array<{
    id: string
    selector: string
    disposition: string
    requiredForCoreRestore: boolean
  }>
  personalCapabilityCuration: { source: string; requiredStatus: string }
  workIntegration: {
    registry: string
    currentStatus: string
    targetDisposition: string
    localScaffold: { repositoryName: string; revision: string; status: string; activated: boolean }
    remoteResourceId: string
    remoteResourceStatus: string
    mayBlockCoreBuildAfterMigration: boolean
  }
  organizationExitCriteria: string[]
}

type RecoveryManifest = { artifacts: Array<{ id: string }> }
type WorkDomainInventory = { baseline: { pathCount: number }; classificationRules: unknown[] }
type PersonalCapabilityCuration = {
  schemaVersion: number
  projectId: string
  status: string
  decisions: Array<{ class: string; disposition: string; requiredForCoreRestore: boolean }>
  selectedPortableAssets: string[]
  coreRestoreDependsOnSelectedAssets: boolean
  reviewTrigger: string
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function trackedPaths(root: string): Set<string> {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  return new Set(output.split(/\r?\n/).filter(Boolean))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function instructionMirrorDigest(contents: readonly string[]) {
  const digests = [...new Set(contents.map(sha256))]
  return { mirrored: digests.length === 1, digest: digests.length === 1 ? digests[0] : null }
}

function portableRepositoryPath(value: string): boolean {
  return Boolean(value) && !value.startsWith('/') && !value.includes('..') && !/^[A-Za-z]:[\\/]/.test(value)
}

export async function auditAssistantContinuity(rootInput = projectRoot) {
  const root = resolve(rootInput)
  const inventory = JSON.parse(await readFile(resolve(root, 'config/assistant-continuity.json'), 'utf8')) as ContinuityInventory
  const recovery = JSON.parse(await readFile(resolve(root, 'config/recovery-manifest.json'), 'utf8')) as RecoveryManifest
  const workDomain = JSON.parse(await readFile(resolve(root, inventory.workIntegration?.registry ?? ''), 'utf8')) as WorkDomainInventory
  const curationSource = inventory.personalCapabilityCuration?.source ?? ''
  const curation = JSON.parse(await readFile(resolve(root, curationSource), 'utf8')) as PersonalCapabilityCuration
  const tracked = trackedPaths(root)
  const blockers: string[] = []
  const outstanding: string[] = []

  if (inventory.schemaVersion !== 1 || inventory.projectId !== 'quarkselfai' || inventory.scope !== 'assistant-capability-organization') {
    blockers.push('unsupported-continuity-inventory')
  }

  const instructionPaths = [inventory.instructionContract?.primary, ...(inventory.instructionContract?.mirrors ?? [])]
  if (inventory.instructionContract?.requiredTracked !== true || inventory.instructionContract?.mustMatchByteForByte !== true) {
    blockers.push('instruction-contract-not-strict')
  }
  if (instructionPaths.some(path => !portableRepositoryPath(path) || !tracked.has(path))) blockers.push('instruction-contract-source-missing')
  const instructionContents = await Promise.all(instructionPaths.map(path => readFile(resolve(root, path), 'utf8')))
  const instructionMirror = instructionMirrorDigest(instructionContents)
  if (!instructionMirror.mirrored) blockers.push('instruction-mirror-drift')

  const repositorySources = [...new Set(inventory.repositorySources ?? [])]
  if (repositorySources.length !== inventory.repositorySources?.length) blockers.push('duplicate-repository-source')
  if (repositorySources.some(path => !portableRepositoryPath(path) || !tracked.has(path))) blockers.push('repository-source-missing')

  const artifactIds = new Set((recovery.artifacts ?? []).map(item => item.id))
  const capabilityIds = new Set<string>()
  for (const capability of inventory.durableCapabilities ?? []) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(capability.id) || capabilityIds.has(capability.id)) blockers.push('invalid-durable-capability')
    capabilityIds.add(capability.id)
    if (!capability.recoveryArtifactIds?.length || capability.recoveryArtifactIds.some(id => !artifactIds.has(id))) {
      blockers.push(`unmapped-durable-capability:${capability.id}`)
    }
  }

  const deviceIds = new Set<string>()
  for (const input of inventory.deviceBoundInputs ?? []) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id) || deviceIds.has(input.id) || !input.selector || !input.disposition) {
      blockers.push('invalid-device-bound-input')
    }
    deviceIds.add(input.id)
  }

  if (!portableRepositoryPath(inventory.workIntegration?.registry ?? '') || !tracked.has(inventory.workIntegration.registry)) {
    blockers.push('work-integration-registry-missing')
  }
  if (!Number.isInteger(workDomain.baseline?.pathCount) || workDomain.baseline.pathCount < 1 || !Array.isArray(workDomain.classificationRules)) {
    blockers.push('work-integration-inventory-invalid')
  }
  if (inventory.workIntegration?.mayBlockCoreBuildAfterMigration !== false) blockers.push('work-integration-core-dependency-not-forbidden')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(inventory.workIntegration?.localScaffold?.repositoryName ?? '')
    || !/^[a-f0-9]{40}$/.test(inventory.workIntegration?.localScaffold?.revision ?? '')
    || inventory.workIntegration?.localScaffold?.status !== 'prepared-unpublished'
    || inventory.workIntegration?.localScaffold?.activated !== false) blockers.push('work-integration-scaffold-evidence-invalid')
  if (inventory.workIntegration?.currentStatus !== 'isolated') outstanding.push('work-integration-not-yet-isolated')
  if (inventory.workIntegration?.remoteResourceStatus !== 'provided') outstanding.push(inventory.workIntegration.remoteResourceId)
  if (!portableRepositoryPath(curationSource) || !tracked.has(curationSource)) blockers.push('personal-capability-curation-source-missing')
  if (curation.schemaVersion !== 1 || curation.projectId !== inventory.projectId
    || curation.status !== inventory.personalCapabilityCuration?.requiredStatus) blockers.push('personal-capability-curation-invalid')
  if (!Array.isArray(curation.decisions) || curation.decisions.length < 4
    || curation.decisions.some(item => !item.class || !item.disposition)) blockers.push('personal-capability-decision-incomplete')
  if (!Array.isArray(curation.selectedPortableAssets)
    || curation.selectedPortableAssets.some(path => !portableRepositoryPath(path) || !tracked.has(path))) blockers.push('selected-personal-asset-missing')
  if (curation.coreRestoreDependsOnSelectedAssets !== false || !curation.reviewTrigger) blockers.push('personal-capability-core-boundary-invalid')

  const requiredCriteria = new Set([
    'instruction-contract-is-tracked-and-mirrored',
    'repository-sources-are-tracked',
    'durable-capabilities-map-to-recovery-artifacts',
    'device-bound-inputs-have-explicit-dispositions',
    'work-integration-has-no-unclassified-assets',
    'work-integration-private-remote-is-selected',
    'personal-portable-assets-have-an-explicit-curation-decision',
  ])
  if (inventory.organizationExitCriteria?.length !== requiredCriteria.size
    || new Set(inventory.organizationExitCriteria).size !== requiredCriteria.size
    || inventory.organizationExitCriteria.some(item => !requiredCriteria.has(item))) blockers.push('organization-exit-criteria-incomplete')

  return {
    ok: blockers.length === 0,
    projectId: inventory.projectId,
    organizationComplete: blockers.length === 0 && outstanding.length === 0,
    instructionContract: {
      tracked: instructionPaths.every(path => tracked.has(path)),
      mirrored: instructionMirror.mirrored,
      digest: instructionMirror.digest,
      sourceCount: instructionPaths.length,
    },
    repositorySourceCount: repositorySources.length,
    durableCapabilityCount: capabilityIds.size,
    deviceBoundInputCount: deviceIds.size,
    personalCapabilityCuration: {
      status: curation.status,
      decisionCount: curation.decisions.length,
      selectedPortableAssetCount: curation.selectedPortableAssets.length,
      coreRestoreDependsOnSelectedAssets: curation.coreRestoreDependsOnSelectedAssets,
    },
    workIntegration: {
      inventoriedPathCount: workDomain.baseline.pathCount,
      currentStatus: inventory.workIntegration.currentStatus,
      localScaffoldStatus: inventory.workIntegration.localScaffold.status,
      localScaffoldActivated: inventory.workIntegration.localScaffold.activated,
      remoteResourceStatus: inventory.workIntegration.remoteResourceStatus,
      mayBlockCoreBuildAfterMigration: inventory.workIntegration.mayBlockCoreBuildAfterMigration,
    },
    outstanding: [...new Set(outstanding)].sort(),
    blockers,
    privacy: { fileContentsIncluded: false, credentialValuesIncluded: false, devicePathsIncluded: false },
  }
}

async function main(): Promise<void> {
  const report = await auditAssistantContinuity(projectRoot)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
