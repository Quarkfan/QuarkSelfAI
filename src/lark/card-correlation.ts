export interface CardCorrelation {
  readonly workflowId: string
  readonly effectId: string
  readonly eventType?: string
  readonly approvalId?: string
  readonly payloadKey?: string
}

const PREFIX = 'quark_'

export function encodeCardCorrelation(value: CardCorrelation): string {
  const json = JSON.stringify({ w: required(value.workflowId, 'workflowId'), f: required(value.effectId, 'effectId'), ...(value.eventType ? { e: required(value.eventType, 'eventType') } : {}), ...(value.approvalId ? { a: required(value.approvalId, 'approvalId') } : {}), ...(value.payloadKey ? { p: field(value.payloadKey) } : {}) })
  return `${PREFIX}${Buffer.from(json).toString('base64url')}`
}

export function decodeCardCorrelation(value: unknown): CardCorrelation {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) throw new Error('card correlation is missing')
  if (value.length > 4_096) throw new Error('card correlation is invalid')
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(value.slice(PREFIX.length), 'base64url').toString('utf8')) }
  catch { throw new Error('card correlation is invalid') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('card correlation is invalid')
  const item = parsed as Record<string, unknown>
  return {
    workflowId: required(item.w, 'workflowId'), effectId: required(item.f, 'effectId'),
    ...(typeof item.e === 'string' && item.e ? { eventType: item.e } : {}),
    ...(typeof item.a === 'string' && item.a ? { approvalId: item.a } : {}),
    ...(typeof item.p === 'string' && item.p ? { payloadKey: field(item.p) } : {}),
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`card ${label} is invalid`)
  return value
}

function field(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) throw new Error('card payloadKey is invalid')
  return value
}
