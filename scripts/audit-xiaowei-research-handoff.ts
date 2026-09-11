import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { prepareXiaoweiResearchHandoff } from '../src/migration/xiaowei-research-handoff.js'
import { auditResourceHash, xiaoweiResearchAuditConfig } from '../src/migration/compat-handoff-audit-config.js'

const statePath = await resolveStatePath(process.argv.find(value => value.startsWith('--state='))?.slice('--state='.length))
const [stateBytes, configBytes, stateInfo] = await Promise.all([readFile(statePath, 'utf8'), readFile(resolve(dirname(statePath), 'config.json'), 'utf8'), stat(statePath)])
const config = JSON.parse(configBytes) as Record<string, unknown>
const auditConfig = xiaoweiResearchAuditConfig(config)
const handoff = prepareXiaoweiResearchHandoff(JSON.parse(stateBytes), auditConfig, stateInfo.mtime.toISOString())
process.stdout.write(`${JSON.stringify({ statePathHash: auditResourceHash(statePath), mode: 'read-only', ...handoff.counts, workflows: handoff.workflows.length,
  agentHash: auditResourceHash(`${auditConfig.agentOpenId}:${auditConfig.agentChatId}`), digest: handoff.digest }, null, 2)}\n`)
async function exists(path: string) { return await access(path).then(() => true, () => false) }
async function resolveStatePath(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit)
  const root = resolve('var/handoff'); const values = await Promise.all((await readdir(root, { withFileTypes: true })).filter(x => x.isDirectory()).map(async x => {
    const path = resolve(root, x.name, 'state.json'); return await exists(path) ? { path, mtime: (await stat(path)).mtimeMs } : undefined
  })); const latest = values.filter(x => x !== undefined).sort((a, b) => b.mtime - a.mtime)[0]
  if (!latest) throw new Error('no managed compatibility state.json found; pass --state=/absolute/path')
  return latest.path
}
