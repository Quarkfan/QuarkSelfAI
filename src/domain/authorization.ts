export interface DurableAuthorizationEvidence {
  readonly id: string
  readonly grantedBy: 'owner'
  readonly grantedAt: string
  readonly scope: string
  readonly revision: number
  readonly source: string
}

/**
 * Validates the portable evidence carried by a durable workflow state/effect.
 * Feature adapters must additionally validate their exact resource and limits.
 */
export function requireAuthorizationEvidence(
  value: unknown,
  expectedScope: string,
  effectiveAt: string,
): DurableAuthorizationEvidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('authorization evidence is required')
  const evidence = value as Record<string, unknown>
  const grantedAt = timestamp(evidence.grantedAt, 'authorization grantedAt')
  const effectiveTime = new Date(timestamp(effectiveAt, 'authorization effectiveAt')).getTime()
  if (new Date(grantedAt).getTime() > effectiveTime) throw new Error('authorization cannot be granted in the future')
  if (evidence.grantedBy !== 'owner') throw new Error('authorization must be granted by the owner')
  if (evidence.scope !== expectedScope) throw new Error(`authorization scope must be ${expectedScope}`)
  if (!Number.isSafeInteger(evidence.revision) || Number(evidence.revision) < 1) throw new Error('authorization revision must be a positive integer')
  return {
    id: text(evidence.id, 'authorization id', 300), grantedBy: 'owner', grantedAt,
    scope: expectedScope, revision: Number(evidence.revision), source: text(evidence.source, 'authorization source', 500),
  }
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return value
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 100)
  if (Number.isNaN(new Date(result).getTime())) throw new Error(`${label} must be a timestamp`)
  return result
}
