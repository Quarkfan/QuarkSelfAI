import type { CapabilityManifestV1 } from './manifest.js'
import { validateCapabilityManifest } from './validation.js'

export interface InactiveCapabilityRecordV1 {
  readonly manifest: CapabilityManifestV1
  readonly registeredAt: string
  readonly state: 'catalogued-inactive'
  readonly consumerCount: 0
  readonly providerLease: null
  readonly schedulerCount: 0
  readonly externalWritesEnabled: false
}

/**
 * A design-time registry seam. It is deliberately not a Cordis plugin and has no lifecycle hook.
 * Registration cannot install, load, authorize, activate, schedule or execute a capability.
 */
export class InactiveCapabilityRegistryV1 {
  readonly #records = new Map<string, InactiveCapabilityRecordV1>()

  register(value: unknown, now = new Date()): InactiveCapabilityRecordV1 {
    const manifest = validateCapabilityManifest(value)
    const key = `${manifest.id}@${manifest.version}`
    const existing = this.#records.get(key)
    if (existing) {
      if (existing.manifest.source.artifactDigest !== manifest.source.artifactDigest) throw new Error(`capability ${key} is already registered with another digest`)
      return existing
    }
    const record: InactiveCapabilityRecordV1 = Object.freeze({
      manifest, registeredAt: now.toISOString(), state: 'catalogued-inactive', consumerCount: 0,
      providerLease: null, schedulerCount: 0, externalWritesEnabled: false,
    })
    this.#records.set(key, record)
    return record
  }

  get(id: string, version: string): InactiveCapabilityRecordV1 | undefined {
    return this.#records.get(`${id}@${version}`)
  }

  list(): readonly InactiveCapabilityRecordV1[] {
    return [...this.#records.values()]
  }
}
