import type { AgentBlueprintV1 } from '../capability-platform/blueprint.js'
import type { ExecutionEnvelopeV1, ExecutorAdapterInputV1 } from '../capability-platform/execution-envelope.js'
import type { CapabilityManifestV1 } from '../capability-platform/manifest.js'
import { blueprintPayloadDigest, contentDigest, toExecutorAdapterInput, validateAgentBlueprint, validateCapabilityManifest } from '../capability-platform/validation.js'

const portablePath = /^(?!\/)(?![A-Za-z]:[\\/])(?!~(?:[\\/]|$))(?!.*(?:^|\/)\.\.(?:\/|$)).+/
const digestPattern = /^sha256:[a-f0-9]{64}$/

export interface ArtifactDigestInputV1 {
  readonly revision: string
  readonly files: readonly { readonly path: string; readonly digest: string }[]
}

/** Combines caller-verified byte digests; this function never reads local files or executes build commands. */
export function buildArtifactDigest(input: ArtifactDigestInputV1): string {
  if (!input.revision.trim()) throw new Error('artifact revision is required')
  if (!input.files.length) throw new Error('artifact digest requires at least one file')
  const files = input.files.map(file => {
    if (!portablePath.test(file.path)) throw new Error(`artifact path must be portable: ${file.path}`)
    if (!digestPattern.test(file.digest)) throw new Error(`artifact file digest is invalid: ${file.path}`)
    return { path: file.path, digest: file.digest }
  }).sort((left, right) => left.path.localeCompare(right.path))
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('artifact file paths must be unique')
  return contentDigest({ revision: input.revision, files })
}

/** Validates, clones and recursively freezes a Manifest without registering, installing or activating it. */
export function defineCapabilityManifest(input: unknown): CapabilityManifestV1 {
  const manifest = structuredClone(validateCapabilityManifest(input))
  return deepFreeze(manifest)
}

/** Creates the canonical Blueprint digest and returns an immutable, validated definition. */
export function defineAgentBlueprint(input: Omit<AgentBlueprintV1, 'digest'>): AgentBlueprintV1 {
  const provisional = { ...structuredClone(input), digest: `sha256:${'0'.repeat(64)}` } as AgentBlueprintV1
  const blueprint = { ...provisional, digest: blueprintPayloadDigest(provisional) }
  return deepFreeze(structuredClone(validateAgentBlueprint(blueprint)))
}

/** Produces one normalized envelope view for each executor and proves context parity without invoking an executor. */
export function executorParityInputs(executorIds: readonly string[], envelope: ExecutionEnvelopeV1): readonly ExecutorAdapterInputV1[] {
  if (!executorIds.length || new Set(executorIds).size !== executorIds.length) throw new Error('executor ids must be non-empty and unique')
  const inputs = executorIds.map(executorId => toExecutorAdapterInput(executorId, structuredClone(envelope)))
  if (new Set(inputs.map(input => input.normalizedContextDigest)).size !== 1) throw new Error('executor normalized contexts diverged')
  return deepFreeze(inputs)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
