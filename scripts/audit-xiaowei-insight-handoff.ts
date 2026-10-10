import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareXiaoweiInsightHandoff } from '../src/migration/xiaowei-insight-handoff.js'
import { auditResourceHash } from '../src/migration/compat-handoff-audit-config.js'

const statePath = await resolveStatePath(process.argv.find(value => value.startsWith('--state='))?.slice(8))
const handoff = prepareXiaoweiInsightHandoff(JSON.parse(await readFile(statePath, 'utf8')))
process.stdout.write(`${JSON.stringify({ statePathHash: auditResourceHash(statePath), mode: 'read-only', ...handoff.counts,
  hasDeliveryCheckpoint: Boolean(handoff.checkpoint), digest: handoff.digest }, null, 2)}\n`)

async function resolveStatePath(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit)
  const root = resolve('var/handoff')
  const candidates = await Promise.all((await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(async entry => {
    const path = resolve(root, entry.name, 'state.json')
    try { return { path, mtime: (await stat(path)).mtimeMs } } catch { return undefined }
  }))
  const latest = candidates.filter(item => item !== undefined).sort((left, right) => right.mtime - left.mtime)[0]
  if (!latest) throw new Error('no managed compatibility state.json found; pass --state=/absolute/path')
  return latest.path
}
