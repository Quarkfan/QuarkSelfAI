import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadModuleCatalog } from '../platform/modules.js'
import type { OperationalReadinessReport } from '../platform/operations.js'

export type FeatureStatus = 'complete' | 'partial' | 'missing'

export interface FeatureParityItem {
  readonly id: string
  readonly name: string
  readonly requiredForTakeover: boolean
  readonly status: FeatureStatus
  readonly evidence: string
}

export interface FeatureParityReport {
  readonly source: string
  readonly features: readonly FeatureParityItem[]
  readonly takeoverReady: boolean
  readonly missingRequired: number
  readonly completed: number
  readonly nativeCutoverReady: boolean
  readonly nativeCutoverBlockers: readonly string[]
}

export interface TakeoverRiskAcceptance {
  readonly acceptedIncomplete: readonly string[]
  readonly unacceptedIncomplete: readonly string[]
  readonly unknownAccepted: readonly string[]
  readonly explicitOwnerConfirmation: boolean
  readonly acceptedRiskCutover: boolean
  readonly ready: boolean
}

export function evaluateTakeoverRiskAcceptance(
  report: FeatureParityReport,
  explicitOwnerConfirmation: boolean,
  acceptedIncompleteValue: string | undefined,
): TakeoverRiskAcceptance {
  const incomplete = report.features
    .filter((feature) => feature.requiredForTakeover && feature.status !== 'complete')
    .map((feature) => feature.id)
    .sort()
  const accepted = [...new Set((acceptedIncompleteValue ?? '').split(',').map((item) => item.trim()).filter(Boolean))].sort()
  const known = new Set(incomplete)
  const acceptedIncomplete = accepted.filter((id) => known.has(id))
  const unknownAccepted = accepted.filter((id) => !known.has(id))
  const acceptedSet = new Set(acceptedIncomplete)
  const unacceptedIncomplete = incomplete.filter((id) => !acceptedSet.has(id))
  const ready = explicitOwnerConfirmation && unacceptedIncomplete.length === 0 && unknownAccepted.length === 0
  return {
    acceptedIncomplete,
    unacceptedIncomplete,
    unknownAccepted,
    explicitOwnerConfirmation,
    acceptedRiskCutover: ready && incomplete.length > 0,
    ready,
  }
}

const manifestFile = fileURLToPath(new URL('../../config/feature-parity.json', import.meta.url))
const migrationPlanFile = fileURLToPath(new URL('../../config/native-migration-plan.json', import.meta.url))

export async function loadFeatureParity(): Promise<FeatureParityReport> {
  const [manifest, catalog, migrationPlan] = await Promise.all([
    readFile(manifestFile, 'utf8').then(value => JSON.parse(value) as { source: string; features: FeatureParityItem[] }),
    loadModuleCatalog(),
    readFile(migrationPlanFile, 'utf8').then(value => JSON.parse(value) as {
      version: number
      units: Array<{ modules: string[]; targetModules: string[] }>
    }),
  ])
  if (migrationPlan.version !== 2 || !Array.isArray(migrationPlan.units)) throw new Error('native migration plan must be version 2')
  const incomplete = manifest.features.filter((feature) => feature.requiredForTakeover && feature.status !== 'complete')
  const migrationModuleIds = new Set(migrationPlan.units.flatMap(unit => [...unit.modules, ...unit.targetModules]))
  const nativeCutoverBlockers = catalog.modules
    .filter(module => migrationModuleIds.has(module.id) && module.runtime !== 'active')
    .map(module => module.id)
  const targetModules = catalog.modules.filter(module => migrationPlan.units.some(unit => unit.targetModules.includes(module.id)))
  const requiredEffects = new Set(targetModules.flatMap(module => module.requiresEffects))
  const effectProviders = new Map(catalog.modules.flatMap(module => module.providesEffects.map(effect => [effect, module] as const)))
  for (const effect of requiredEffects) {
    const provider = effectProviders.get(effect)
    if (!provider || provider.implementation !== 'ready') nativeCutoverBlockers.push(`effect-implementation:${effect}`)
    else if (provider.runtime !== 'active') nativeCutoverBlockers.push(`effect-inactive:${effect}`)
  }
  nativeCutoverBlockers.sort()
  return {
    ...manifest,
    takeoverReady: incomplete.length === 0,
    missingRequired: incomplete.length,
    completed: manifest.features.filter((feature) => feature.status === 'complete').length,
    nativeCutoverReady: incomplete.length === 0 && nativeCutoverBlockers.length === 0,
    nativeCutoverBlockers,
  }
}

/** Migration adapter from the historical parity document to an open readiness gate. */
export async function loadNativeCutoverReadiness(): Promise<OperationalReadinessReport> {
  const report = await loadFeatureParity()
  return {
    id: 'native-cutover',
    source: report.source,
    state: report.nativeCutoverReady ? 'ready' : 'blocked',
    items: report.features.map(feature => ({
      id: feature.id, name: feature.name, status: feature.status, evidence: feature.evidence,
    })),
    blockers: report.nativeCutoverBlockers,
    summary: {
      completed: report.completed,
      total: report.features.length,
      missingRequired: report.missingRequired,
      functionalParityReady: report.takeoverReady,
      nativeCutoverReady: report.nativeCutoverReady,
    },
  }
}
