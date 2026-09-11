import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { prepareSessionLifecycleHandoff } from '../src/migration/session-lifecycle-handoff.js'
import { auditResourceHash, sessionLifecycleAuditConfig } from '../src/migration/compat-handoff-audit-config.js'

const argument = process.argv.find(value => value.startsWith('--state='))
const statePath = await resolveStatePath(argument?.slice('--state='.length))
const configPath = resolve(dirname(statePath), 'config.json')
const [stateBytes, configBytes, stateInfo] = await Promise.all([readFile(statePath, 'utf8'), readFile(configPath, 'utf8'), stat(statePath)])
const config = JSON.parse(configBytes) as Record<string, unknown>
const handoff = prepareSessionLifecycleHandoff(JSON.parse(stateBytes), sessionLifecycleAuditConfig(config), stateInfo.mtime.toISOString())
process.stdout.write(`${JSON.stringify({ statePathHash: auditResourceHash(statePath), mode: 'read-only', ...handoff.counts, workflows: handoff.workflows.length, digest: handoff.digest }, null, 2)}\n`)
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
