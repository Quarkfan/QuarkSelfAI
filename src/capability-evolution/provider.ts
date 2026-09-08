import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type CapabilityEvolutionOutcome = 'running' | 'no-change' | 'upgraded' | 'candidate' | 'failed'
export type CapabilityEvolutionTrack = 'reliability' | 'measurable-enhancement' | 'strategic-opportunity'

export interface CapabilityEvolutionReport {
  readonly track?: CapabilityEvolutionTrack
  readonly title: string
  readonly summary: string
  readonly recordedAt: string
  readonly outcome: Exclude<CapabilityEvolutionOutcome, 'running' | 'no-change'>
  readonly commit?: string
  readonly taskId?: string
}

export interface CapabilityEvolutionRun {
  readonly track?: CapabilityEvolutionTrack
  readonly title: string
  readonly startedAt: string
  readonly completedAt?: string
  readonly outcome: CapabilityEvolutionOutcome
  readonly summary: string
  readonly taskId?: string
}

export interface CapabilityEvolutionStatus {
  readonly configured: boolean
  readonly state: 'active' | 'paused' | 'missing' | 'invalid'
  readonly automationId: string
  readonly name: string
  readonly mode?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly schedule?: string
  readonly scheduleLabel?: string
  readonly workspace?: string
  readonly latestRun?: CapabilityEvolutionRun
  readonly trajectory: CapabilityEvolutionTrajectory
  readonly reports: readonly CapabilityEvolutionReport[]
  readonly error?: string
}

export interface CapabilityEvolutionTrajectory {
  readonly windowSize: 5
  readonly trackedRuns: number
  readonly distinctTracks: number
  readonly state: 'insufficient-data' | 'balanced' | 'skewed'
  readonly counts: Readonly<Record<CapabilityEvolutionTrack, number>>
  readonly nextTrackPreference?: CapabilityEvolutionTrack
}

export interface CapabilityEvolutionProvider { inspect(): Promise<CapabilityEvolutionStatus> }

export interface FileCapabilityEvolutionProviderOptions {
  readonly automationPath?: string
  readonly statusPath?: string
}

const dayLabels: Readonly<Record<string, string>> = {
  MO: '周一', TU: '周二', WE: '周三', TH: '周四', FR: '周五', SA: '周六', SU: '周日',
}

function tomlString(text: string, key: string): string | undefined {
  const match = new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, 'm').exec(text)
  if (!match?.[1]) return undefined
  try { return JSON.parse(match[1]) as string } catch { return undefined }
}

function inlineString(text: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")`).exec(text)
  if (!match?.[1]) return undefined
  try { return JSON.parse(match[1]) as string } catch { return undefined }
}

function scheduleLabel(rrule: string | undefined): string | undefined {
  if (!rrule) return undefined
  const fields = Object.fromEntries(rrule.split(';').map(item => item.split('=', 2)))
  if (fields.FREQ !== 'WEEKLY') return rrule
  const days = String(fields.BYDAY ?? '').split(',').filter(Boolean)
  const workdays = ['MO', 'TU', 'WE', 'TH', 'FR']
  const everyDay = [...workdays, 'SA', 'SU']
  const sameDays = (expected: readonly string[]) => days.length === expected.length && expected.every(day => days.includes(day))
  const day = sameDays(workdays)
    ? '个工作日'
    : sameDays(everyDay)
      ? '天'
      : days.map(value => dayLabels[value] ?? value).join('、') || undefined
  const hour = String(Number(fields.BYHOUR ?? 0)).padStart(2, '0')
  const minute = String(Number(fields.BYMINUTE ?? 0)).padStart(2, '0')
  return `每${day ?? '周'} ${hour}:${minute}`
}

function short(value: unknown, limit = 320): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.slice(0, limit)
}

function timestamp(value: unknown): string | undefined {
  const candidate = short(value, 64)
  if (!candidate || Number.isNaN(new Date(candidate).getTime())) return undefined
  return candidate
}

function track(value: unknown): CapabilityEvolutionTrack | undefined {
  return ['reliability', 'measurable-enhancement', 'strategic-opportunity'].includes(String(value))
    ? value as CapabilityEvolutionTrack
    : undefined
}

function run(value: unknown): CapabilityEvolutionRun | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const title = short(item.title, 120)
  const startedAt = timestamp(item.startedAt)
  const summary = short(item.summary)
  const outcome = item.outcome
  if (!title || !startedAt || !summary || !['running', 'no-change', 'upgraded', 'candidate', 'failed'].includes(String(outcome))) return undefined
  const completedAt = timestamp(item.completedAt)
  const taskId = short(item.taskId, 100)
  const runTrack = track(item.track)
  return { title, startedAt, outcome: outcome as CapabilityEvolutionOutcome, summary, ...(runTrack ? { track: runTrack } : {}), ...(completedAt ? { completedAt } : {}), ...(taskId ? { taskId } : {}) }
}

function report(value: unknown): CapabilityEvolutionReport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const title = short(item.title, 120)
  const summary = short(item.summary)
  const recordedAt = timestamp(item.recordedAt)
  const outcome = item.outcome
  if (!title || !summary || !recordedAt || !['upgraded', 'candidate', 'failed'].includes(String(outcome))) return undefined
  const commit = short(item.commit, 64)
  const taskId = short(item.taskId, 100)
  const reportTrack = track(item.track)
  return { title, summary, recordedAt, outcome: outcome as CapabilityEvolutionReport['outcome'], ...(reportTrack ? { track: reportTrack } : {}), ...(commit ? { commit } : {}), ...(taskId ? { taskId } : {}) }
}

function trajectory(history: readonly CapabilityEvolutionRun[]): CapabilityEvolutionTrajectory {
  const tracks: readonly CapabilityEvolutionTrack[] = ['reliability', 'measurable-enhancement', 'strategic-opportunity']
  const window = history.filter(item => item.track !== undefined).toSorted((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)).slice(0, 5)
  const counts = Object.freeze(Object.fromEntries(tracks.map(item => [item, window.filter(run => run.track === item).length]))) as Readonly<Record<CapabilityEvolutionTrack, number>>
  const distinctTracks = tracks.filter(item => counts[item] > 0).length
  const state = window.length < 5 ? 'insufficient-data' : distinctTracks >= 2 ? 'balanced' : 'skewed'
  const minimum = Math.min(...tracks.map(item => counts[item]))
  const lastTrack = window[0]?.track
  const nextTrackPreference = tracks.find(item => counts[item] === minimum && item !== lastTrack) ?? tracks.find(item => counts[item] === minimum)
  return { windowSize: 5, trackedRuns: window.length, distinctTracks, state, counts, ...(nextTrackPreference ? { nextTrackPreference } : {}) }
}

async function readLedger(path: string): Promise<{ latestRun?: CapabilityEvolutionRun; trajectory: CapabilityEvolutionTrajectory; reports: readonly CapabilityEvolutionReport[] }> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    if (parsed.version !== 1) return { trajectory: trajectory([]), reports: [] }
    const latestRun = run(parsed.latestRun)
    const history = Array.isArray(parsed.history) ? parsed.history.map(run).filter(item => item !== undefined).slice(0, 12) : []
    const reports = Array.isArray(parsed.reports) ? parsed.reports.map(report).filter(item => item !== undefined).slice(0, 12) : []
    return { ...(latestRun ? { latestRun } : {}), trajectory: trajectory(history), reports }
  } catch { return { trajectory: trajectory([]), reports: [] } }
}

export class FileCapabilityEvolutionProvider implements CapabilityEvolutionProvider {
  readonly #automationPath: string
  readonly #statusPath: string

  constructor(options: FileCapabilityEvolutionProviderOptions = {}) {
    const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
    this.#automationPath = options.automationPath ?? join(codexHome, 'automations', 'quarkselfai', 'automation.toml')
    this.#statusPath = options.statusPath ?? resolve(process.cwd(), 'var', 'capability-evolution', 'status.json')
  }

  async inspect(): Promise<CapabilityEvolutionStatus> {
    const ledger = await readLedger(this.#statusPath)
    let text: string
    try { text = await readFile(this.#automationPath, 'utf8') } catch {
      return { configured: false, state: 'missing', automationId: 'quarkselfai', name: 'QuarkSelfAI 能力进化巡检', trajectory: ledger.trajectory, reports: ledger.reports, ...(ledger.latestRun ? { latestRun: ledger.latestRun } : {}) }
    }
    const id = tomlString(text, 'id')
    const name = tomlString(text, 'name')
    const status = tomlString(text, 'status')
    const mode = tomlString(text, 'kind')
    if (!id || !name || !status || !mode) {
      return { configured: false, state: 'invalid', automationId: id ?? 'quarkselfai', name: name ?? '能力进化巡检', trajectory: ledger.trajectory, reports: ledger.reports, error: '自动化配置无法安全解析', ...(ledger.latestRun ? { latestRun: ledger.latestRun } : {}) }
    }
    const schedule = tomlString(text, 'rrule')
    const cadence = scheduleLabel(schedule)
    const model = tomlString(text, 'model')
    const reasoningEffort = tomlString(text, 'reasoning_effort')
    const workspace = inlineString(text, 'project_id')
    return {
      configured: true,
      state: status === 'ACTIVE' ? 'active' : 'paused',
      automationId: id,
      name,
      mode,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(schedule ? { schedule } : {}),
      ...(cadence ? { scheduleLabel: cadence } : {}),
      ...(workspace ? { workspace } : {}),
      ...(ledger.latestRun ? { latestRun: ledger.latestRun } : {}),
      trajectory: ledger.trajectory,
      reports: ledger.reports,
    }
  }
}
