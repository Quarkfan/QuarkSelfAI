import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { prepareDidaMaintenanceHandoff } from '../src/migration/dida-maintenance-handoff.js'
import { auditResourceHash, didaMaintenanceAuditConfig } from '../src/migration/compat-handoff-audit-config.js'

const argument = process.argv.find(value => value.startsWith('--state='))
const statePath = await resolveStatePath(argument?.slice('--state='.length))
const configPath = resolve(dirname(statePath), 'config.json')
const [stateBytes, configBytes, stateInfo] = await Promise.all([readFile(statePath, 'utf8'), readFile(configPath, 'utf8'), stat(statePath)])
const legacyConfig = JSON.parse(configBytes) as Record<string, unknown>
const config = didaMaintenanceAuditConfig(legacyConfig)
const handoff = prepareDidaMaintenanceHandoff(JSON.parse(stateBytes), config, stateInfo.mtime.toISOString())
process.stdout.write(`${JSON.stringify({
  statePathHash: auditResourceHash(statePath), mode: 'read-only', ...handoff.counts, workflows: handoff.workflows.length,
  projectIdHash: auditResourceHash(config.projectId), digest: handoff.digest,
}, null, 2)}\n`)
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
