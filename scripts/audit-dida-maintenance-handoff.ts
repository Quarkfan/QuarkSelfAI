import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { prepareDidaMaintenanceHandoff } from '../src/migration/dida-maintenance-handoff.js'

const argument = process.argv.find(value => value.startsWith('--state='))
const statePath = await resolveStatePath(argument?.slice('--state='.length))
const configPath = resolve(dirname(statePath), 'config.json')
const [stateBytes, configBytes, stateInfo] = await Promise.all([readFile(statePath, 'utf8'), readFile(configPath, 'utf8'), stat(statePath)])
const legacyConfig = JSON.parse(configBytes) as Record<string, unknown>
if (typeof legacyConfig.didaProjectId !== 'string' || !legacyConfig.didaProjectId) throw new Error('compat config has no didaProjectId')
const handoff = prepareDidaMaintenanceHandoff(JSON.parse(stateBytes), {
  projectId: legacyConfig.didaProjectId,
  overdueIntervalMs: number(legacyConfig.overduePollIntervalMs),
  overdueRetryMs: number(legacyConfig.overdueRetryIntervalMs),
  failureNotifyThreshold: number(legacyConfig.overdueFailureNotifyThreshold),
  cleanupTimeZone: typeof legacyConfig.didaCompletedCleanupTimeZone === 'string' ? legacyConfig.didaCompletedCleanupTimeZone : undefined,
  cleanupHour: number(legacyConfig.didaCompletedCleanupHour),
  cleanupPollIntervalMs: number(legacyConfig.didaCompletedCleanupIntervalMs),
  cleanupFailureNotifyThreshold: number(legacyConfig.didaCompletedCleanupFailureNotifyThreshold),
  completedRetentionDays: number(legacyConfig.didaCompletedRetentionDays),
  cleanupMaxPerRun: number(legacyConfig.didaCompletedCleanupMaxPerRun),
  cleanupAuthorization: {
    id: 'owner-policy:dida-completed-cleanup:v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00+08:00',
    scope: 'dida.completed-task-cleanup', revision: 1,
    source: 'owner-directive:periodically-clean-completed-automation-tasks',
    projectId: legacyConfig.didaProjectId, minimumRetentionDays: 30, maximumDeletesPerRun: 50,
  },
}, stateInfo.mtime.toISOString())
process.stdout.write(`${JSON.stringify({
  statePath, mode: 'read-only', ...handoff.counts, workflows: handoff.workflows.length,
  projectIdHash: createHash('sha256').update(legacyConfig.didaProjectId).digest('hex').slice(0, 16), digest: handoff.digest,
}, null, 2)}\n`)

function number(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
async function exists(path: string) { return await access(path).then(() => true, () => false) }
async function resolveStatePath(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit)
  const handoffRoot = resolve('var/handoff')
  const candidates = await Promise.all((await readdir(handoffRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(async entry => {
    const path = resolve(handoffRoot, entry.name, 'state.json')
    return await exists(path) ? { path, modified: (await stat(path)).mtimeMs } : undefined
  }))
  const latest = candidates.filter(candidate => candidate !== undefined).sort((left, right) => right.modified - left.modified)[0]
  if (!latest) throw new Error('no managed compatibility state.json found; pass --state=/absolute/path')
  return latest.path
}
