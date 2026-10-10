import { validateWorkPackManifestV1, validateWorkPackRegistrationV1, type WorkPackManifestV1, type WorkPackRegistrationV1 } from './contracts.js'

export interface InactiveWorkPackSnapshotV1 {
  readonly packId: string
  readonly packVersion: string
  readonly sourceRevision: string
  readonly contributionCount: number
  readonly state: 'registered-inactive'
}

export interface WorkIntegrationRegistrySnapshotV1 {
  readonly contractVersion: '1.0.0'
  readonly packs: readonly InactiveWorkPackSnapshotV1[]
  readonly consumers: 0
  readonly activeProviders: 0
  readonly schedulers: 0
  readonly externalWriters: 0
  readonly activationAvailable: false
}

export class WorkIntegrationRegistryV1 {
  readonly #packs = new Map<string, InactiveWorkPackSnapshotV1>()
  readonly #ownership = new Map<string, string>()

  registerInactive(manifestInput: unknown, registrationInput: unknown): InactiveWorkPackSnapshotV1 {
    const manifest = validateWorkPackManifestV1(manifestInput)
    const registration = validateWorkPackRegistrationV1(registrationInput)
    assertRegistrationMatches(manifest, registration)
    if (this.#packs.has(manifest.packId)) throw new Error(`work pack already registered: ${manifest.packId}`)
    for (const contribution of registration.contributions) {
      if (contribution.ownershipSemantics !== 'exclusive') continue
      const owner = this.#ownership.get(contribution.ownershipKey)
      if (owner) throw new Error(`exclusive ownership already registered: ${contribution.ownershipKey}`)
    }
    const snapshot = Object.freeze({
      packId: manifest.packId,
      packVersion: manifest.packVersion,
      sourceRevision: manifest.source.revision,
      contributionCount: registration.contributions.length,
      state: 'registered-inactive' as const,
    })
    this.#packs.set(manifest.packId, snapshot)
    for (const contribution of registration.contributions) if (contribution.ownershipSemantics === 'exclusive') this.#ownership.set(contribution.ownershipKey, manifest.packId)
    return snapshot
  }

  snapshot(): WorkIntegrationRegistrySnapshotV1 {
    return Object.freeze({
      contractVersion: '1.0.0',
      packs: Object.freeze([...this.#packs.values()].sort((left, right) => left.packId.localeCompare(right.packId))),
      consumers: 0, activeProviders: 0, schedulers: 0, externalWriters: 0, activationAvailable: false,
    })
  }
}

function assertRegistrationMatches(manifest: WorkPackManifestV1, registration: WorkPackRegistrationV1): void {
  if (registration.packId !== manifest.packId || registration.packVersion !== manifest.packVersion || registration.contractVersion !== manifest.contract.version) throw new Error('work pack registration identity mismatch')
  if (JSON.stringify(registration.contributions) !== JSON.stringify(manifest.contributions)) throw new Error('work pack registration contributions mismatch')
}
