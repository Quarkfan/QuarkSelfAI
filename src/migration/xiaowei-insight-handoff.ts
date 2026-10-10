import { createHash } from 'node:crypto'

export interface XiaoweiInsightHandoff {
  readonly checkpoint?: Readonly<Record<string, unknown>>
  readonly digest: string
  readonly counts: { readonly completedWindows: number; readonly reports: number }
}

export interface XiaoweiInsightHandoffTarget {
  readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined>
  writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function timestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a timestamp`)
  return value
}

function day(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('Xiaowei insight lastSentDay must be an ISO date')
  return value
}

/**
 * Migrates only the completed delivery boundary. Reports, prompts, candidate
 * messages and transient failures remain outside the native checkpoint.
 */
export function prepareXiaoweiInsightHandoff(legacyRoot: unknown): XiaoweiInsightHandoff {
  const root = record(legacyRoot) ?? {}
  const insight = record(root.xiaoweiInsightDigest)
  if (!insight) return {
    digest: createHash('sha256').update('null').digest('hex'),
    counts: { completedWindows: 0, reports: 0 },
  }
  const lastSentDay = day(insight.lastSentDay)
  const lastWindowEndAt = timestamp(insight.lastWindowEndAt, 'Xiaowei insight lastWindowEndAt')
  if (lastSentDay && !lastWindowEndAt) throw new Error('Xiaowei insight completed day has no window end')
  if (!lastSentDay && lastWindowEndAt) throw new Error('Xiaowei insight window end has no completed day')
  const reports = Array.isArray(insight.reports) ? insight.reports.length : 0
  const checkpoint = lastSentDay && lastWindowEndAt ? {
    lastSentDay,
    lastWindowEndAt,
    deliveryFingerprint: createHash('sha256').update(`xiaowei-insight-digest\0${lastSentDay}\0${lastWindowEndAt}`).digest('hex'),
  } : undefined
  return {
    ...(checkpoint ? { checkpoint } : {}),
    digest: createHash('sha256').update(canonical(checkpoint ?? null)).digest('hex'),
    counts: { completedWindows: checkpoint ? 1 : 0, reports },
  }
}

/** Applies an audited checkpoint once and refuses to overwrite divergent native state. */
export async function applyXiaoweiInsightHandoff(
  target: XiaoweiInsightHandoffTarget,
  handoff: XiaoweiInsightHandoff,
  expectedDigest: string,
): Promise<{ readonly written: number; readonly existing: number }> {
  if (handoff.digest !== expectedDigest) throw new Error('Xiaowei insight handoff digest changed after audit')
  if (!handoff.checkpoint) return { written: 0, existing: 0 }
  const existing = await target.readFeatureCheckpoint('xiaowei-insight-digest', 'delivery-window')
  if (existing) {
    if (canonical(existing) !== canonical(handoff.checkpoint)) throw new Error('native Xiaowei insight checkpoint already has different content')
    return { written: 0, existing: 1 }
  }
  await target.writeFeatureCheckpoint('xiaowei-insight-digest', 'delivery-window', handoff.checkpoint)
  return { written: 1, existing: 0 }
}
