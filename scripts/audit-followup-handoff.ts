import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { prepareFollowupHandoff } from '../src/migration/followup-handoff.js'

const statePath = await resolveStatePath(process.argv.find(value => value.startsWith('--state='))?.slice('--state='.length))
const [stateBytes, configBytes, stateInfo] = await Promise.all([readFile(statePath, 'utf8'), readFile(resolve(dirname(statePath), 'config.json'), 'utf8'), stat(statePath)])
const config = JSON.parse(configBytes) as Record<string, unknown>
const handoff = prepareFollowupHandoff(JSON.parse(stateBytes), { timeZone: string(config.followupTimeZone), scheduledHour: number(config.followupScheduledHour), pollIntervalMs: number(config.followupPollIntervalMs), retryBaseMs: 120_000, retryMaxMs: 21_600_000 }, stateInfo.mtime.toISOString())
process.stdout.write(`${JSON.stringify({ statePath, mode: 'read-only', ...handoff.counts, workflows: handoff.workflows.length, digest: handoff.digest }, null, 2)}\n`)
function string(value: unknown) { return typeof value === 'string' && value ? value : undefined }
function number(value: unknown) { if (typeof value === 'number') return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value); return undefined }
async function exists(path: string) { return await access(path).then(() => true, () => false) }
async function resolveStatePath(explicit?: string): Promise<string> { if (explicit) return resolve(explicit); const root = resolve('var/handoff'); const entries = await Promise.all((await readdir(root, { withFileTypes: true })).filter(x => x.isDirectory()).map(async x => { const path = resolve(root, x.name, 'state.json'); return await exists(path) ? { path, mtime: (await stat(path)).mtimeMs } : undefined })); const latest = entries.filter(x => x !== undefined).sort((a, b) => b.mtime - a.mtime)[0]; if (!latest) throw new Error('no managed compatibility state.json found; pass --state=/absolute/path'); return latest.path }
