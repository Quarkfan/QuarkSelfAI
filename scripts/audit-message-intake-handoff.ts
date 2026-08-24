import { access, readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareMessageIntakeHandoff } from '../src/migration/message-intake-handoff.js'

const statePath = await resolveStatePath(process.argv.find(value => value.startsWith('--state='))?.slice('--state='.length))
const [bytes, info] = await Promise.all([readFile(statePath, 'utf8'), stat(statePath)])
const handoff = prepareMessageIntakeHandoff(JSON.parse(bytes), info.mtime.toISOString())
process.stdout.write(`${JSON.stringify({ statePath, mode: 'read-only', ...handoff.counts, checkpoint: handoff.checkpoint, digest: handoff.digest }, null, 2)}\n`)

async function exists(path: string) { return await access(path).then(() => true, () => false) }
async function resolveStatePath(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit)
  const root = resolve('var/handoff')
  const entries = await Promise.all((await readdir(root, { withFileTypes: true })).filter(x => x.isDirectory()).map(async x => {
    const path = resolve(root, x.name, 'state.json')
    return await exists(path) ? { path, mtime: (await stat(path)).mtimeMs } : undefined
  }))
  const latest = entries.filter(x => x !== undefined).sort((a, b) => b.mtime - a.mtime)[0]
  if (!latest) throw new Error('no managed compatibility state.json found; pass --state=/absolute/path')
  return latest.path
}
