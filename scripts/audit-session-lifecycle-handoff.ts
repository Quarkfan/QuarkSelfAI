import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { prepareSessionLifecycleHandoff } from '../src/migration/session-lifecycle-handoff.js'

const argument = process.argv.find(value => value.startsWith('--state='))
const statePath = await resolveStatePath(argument?.slice('--state='.length))
const configPath = resolve(dirname(statePath), 'config.json')
const [stateBytes, configBytes, stateInfo] = await Promise.all([readFile(statePath, 'utf8'), readFile(configPath, 'utf8'), stat(statePath)])
const config = JSON.parse(configBytes) as Record<string, unknown>
const handoff = prepareSessionLifecycleHandoff(JSON.parse(stateBytes), {
  pollIntervalMs: numeric(config.sessionCleanupIntervalMs), retryBaseMs: numeric(config.sessionRetryBaseMs),
  retryMaxMs: numeric(config.sessionRetryMaxMs), deleteAfterDays: numeric(config.sessionDeleteAfterDays),
  authorization: {
    id: 'owner-policy:codex-auto-research-session-lifecycle:v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00+08:00',
    scope: 'codex.auto-research-session-lifecycle', revision: 1,
    source: 'owner-directive:archive-completed-and-delete-after-one-week', minimumArchivedDays: 7,
  },
}, stateInfo.mtime.toISOString())
process.stdout.write(`${JSON.stringify({ statePath, mode: 'read-only', ...handoff.counts, workflows: handoff.workflows.length, digest: handoff.digest }, null, 2)}\n`)

function numeric(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
async function exists(path: string) { return await access(path).then(() => true, () => false) }
async function resolveStatePath(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit)
  const root = resolve('var/handoff')
  const candidates = await Promise.all((await readdir(root, { withFileTypes: true })).filter(item => item.isDirectory()).map(async item => {
    const path = resolve(root, item.name, 'state.json'); return await exists(path) ? { path, modified: (await stat(path)).mtimeMs } : undefined
  }))
  const latest = candidates.filter(item => item !== undefined).sort((a, b) => b.modified - a.modified)[0]
  if (!latest) throw new Error('no managed compatibility state.json found; pass --state=/absolute/path')
  return latest.path
}
