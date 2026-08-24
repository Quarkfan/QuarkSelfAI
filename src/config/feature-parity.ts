import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadModuleCatalog } from '../platform/modules.js'

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

export async function loadFeatureParity(): Promise<FeatureParityReport> {
  const [manifest, catalog] = await Promise.all([
    readFile(manifestFile, 'utf8').then(value => JSON.parse(value) as { source: string; features: FeatureParityItem[] }),
    loadModuleCatalog(),
  ])
  const incomplete = manifest.features.filter((feature) => feature.requiredForTakeover && feature.status !== 'complete')
  const nativeCutoverBlockers = catalog.modules
    .filter(module => module.classification === 'feature' && module.status !== 'native')
    .map(module => module.id)
    .sort()
  return {
    ...manifest,
    takeoverReady: incomplete.length === 0,
    missingRequired: incomplete.length,
    completed: manifest.features.filter((feature) => feature.status === 'complete').length,
    nativeCutoverReady: incomplete.length === 0 && nativeCutoverBlockers.length === 0,
    nativeCutoverBlockers,
  }
}
