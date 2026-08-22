import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

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
}

const manifestFile = fileURLToPath(new URL('../../config/feature-parity.json', import.meta.url))

export async function loadFeatureParity(): Promise<FeatureParityReport> {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
    source: string
    features: FeatureParityItem[]
  }
  const incomplete = manifest.features.filter((feature) => feature.requiredForTakeover && feature.status !== 'complete')
  return {
    ...manifest,
    takeoverReady: incomplete.length === 0,
    missingRequired: incomplete.length,
    completed: manifest.features.filter((feature) => feature.status === 'complete').length,
  }
}
