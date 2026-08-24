import { access, readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareCollaborationLearningHandoff } from '../src/migration/collaboration-learning-handoff.js'

const argument = process.argv.find(value => value.startsWith('--state='))
const statePath = await resolveStatePath(argument?.slice('--state='.length) || process.env.LEGACY_BRIDGE_STATE_PATH)
const parsed = JSON.parse(await readFile(statePath, 'utf8')) as unknown
const handoff = prepareCollaborationLearningHandoff(parsed)
process.stdout.write(`${JSON.stringify({
  statePath,
  mode: 'read-only',
  ...handoff.counts,
  checkpoints: Object.keys(handoff.checkpoints).sort(),
  digest: handoff.digest,
}, null, 2)}\n`)

async function resolveStatePath(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit)
  const legacy = resolve('../../codex-lark-bridge/var/state.json')
  if (await exists(legacy)) return legacy
  const handoffRoot = resolve('var/handoff')
  const candidates = await Promise.all((await readdir(handoffRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(async entry => {
      const path = resolve(handoffRoot, entry.name, 'state.json')
      return await exists(path) ? { path, modified: (await stat(path)).mtimeMs } : undefined
    }))
  const latest = candidates.filter(candidate => candidate !== undefined).sort((left, right) => right.modified - left.modified)[0]
  if (!latest) throw new Error('no legacy or managed compatibility state.json found; pass --state=/absolute/path')
  return latest.path
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(() => true, () => false)
}
