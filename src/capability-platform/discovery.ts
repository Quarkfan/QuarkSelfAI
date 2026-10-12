/** Read-only, runtime-inactive projection over existing capability source records. */
export interface CapabilityDiscoveryRefV1 {
  readonly id: string
  readonly name: string
  readonly source: 'first-party-candidate' | 'external-source'
  readonly kind: string
  readonly state: 'candidate-inactive' | 'catalogued-inactive' | 'stale-inactive'
  readonly detailRef: string
  readonly executable: false
  readonly matchReason?: readonly string[]
}

export interface CapabilityDiscoveryDetailV1 extends CapabilityDiscoveryRefV1 {
  readonly blockers: readonly string[]
  readonly sourceVersion?: string
  readonly sourceUrl?: string
  readonly reviewBy?: string
}

export interface CapabilityDiscoveryIndexV1 {
  readonly entries: readonly CapabilityDiscoveryRefV1[]
  readonly inspect: (id: string) => CapabilityDiscoveryDetailV1 | undefined
}

type SourceRecord = Record<string, unknown>

function record(value: unknown, label: string): SourceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as SourceRecord
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing`)
  return value.trim()
}

function blockers(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${label} blockers are invalid`)
  return [...value]
}

function date(value: unknown, label: string): string {
  const text = nonempty(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error(`${label} is invalid`)
  return text
}

/** Indexes metadata, never loads Skill bodies, downloads artifacts, or calls a provider. */
export function compileCapabilityDiscoveryIndex(candidatesInput: unknown, externalInput: unknown, now: string): CapabilityDiscoveryIndexV1 {
  const candidates = record(candidatesInput, 'candidates catalog')
  const external = record(externalInput, 'external source catalog')
  if (candidates.schemaVersion !== 1 || !Array.isArray(candidates.candidates)) throw new Error('candidates catalog schema is invalid')
  if (external.schemaVersion !== 1 || !Array.isArray(external.sources)) throw new Error('external source catalog schema is invalid')
  if (Number.isNaN(Date.parse(now))) throw new Error('discovery time is invalid')
  const today = new Date(now).toISOString().slice(0, 10)
  const details = new Map<string, CapabilityDiscoveryDetailV1>()

  for (const item of candidates.candidates) {
    const source = record(item, 'candidate')
    const id = `capability:${nonempty(source.id, 'candidate id')}`
    if (source.activationAllowed !== false || source.publicationAllowed !== false) throw new Error(`${id} is not an inactive candidate`)
    const detail: CapabilityDiscoveryDetailV1 = {
      id, name: nonempty(source.name, `${id} name`), source: 'first-party-candidate',
      kind: nonempty(source.kind, `${id} kind`), state: 'candidate-inactive',
      detailRef: `config/capability-artifact-candidates.json#${encodeURIComponent(String(source.id))}`,
      executable: false, blockers: blockers(source.blockers, id),
    }
    if (details.has(id)) throw new Error(`duplicate discovery id ${id}`)
    details.set(id, Object.freeze(detail))
  }

  for (const item of external.sources) {
    const source = record(item, 'external source')
    const id = `external:${nonempty(source.id, 'external source id')}`
    if (source.state !== 'catalogued-inactive' || source.activationAllowed !== false || source.installationAllowed !== false || source.liveCallsAllowed !== false) {
      throw new Error(`${id} is not an inactive external source`)
    }
    const reviewBy = date(source.reviewBy, `${id} reviewBy`)
    const detail: CapabilityDiscoveryDetailV1 = {
      id, name: nonempty(source.id, `${id} name`), source: 'external-source',
      kind: nonempty(source.kind, `${id} kind`),
      state: reviewBy < today ? 'stale-inactive' : 'catalogued-inactive',
      detailRef: nonempty(source.reference, `${id} reference`), executable: false,
      blockers: blockers(source.blockers, id), sourceVersion: nonempty(source.observedSkillVersion, `${id} version`),
      sourceUrl: nonempty(source.sourceUrl, `${id} URL`), reviewBy,
    }
    if (details.has(id)) throw new Error(`duplicate discovery id ${id}`)
    details.set(id, Object.freeze(detail))
  }

  const entries = [...details.values()].map(({ blockers: _blockers, sourceVersion: _sourceVersion, sourceUrl: _sourceUrl, reviewBy: _reviewBy, ...ref }) => Object.freeze(ref))
  return Object.freeze({
    entries: Object.freeze(entries),
    inspect: (id: string) => details.get(id),
  })
}

/** Deterministic prefilter. Semantic intent interpretation remains with the caller. */
export function discoverCapabilities(index: CapabilityDiscoveryIndexV1, query: string, limit = 20): readonly CapabilityDiscoveryRefV1[] {
  if (!query.trim() || query.length > 160) throw new Error('discovery query must contain 1-160 characters')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('discovery limit must be 1-50')
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
  if (terms.length < 1 || terms.length > 12) throw new Error('discovery query has too many terms')
  return index.entries.flatMap(item => {
    const tokens = new Set(`${item.id} ${item.name} ${item.kind}`.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    if (!terms.every(term => tokens.has(term))) return []
    return [{ item, matched: terms, score: Number(item.id.toLocaleLowerCase() === query.toLocaleLowerCase()) }]
  }).sort((a, b) => Number(b.item.source === 'first-party-candidate') - Number(a.item.source === 'first-party-candidate')
    || b.score - a.score || a.item.id.localeCompare(b.item.id)).slice(0, limit)
    .map(({ item, matched }) => Object.freeze({ ...item, matchReason: matched }))
}
