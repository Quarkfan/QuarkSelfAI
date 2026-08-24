import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { prepareXiaoweiResearchHandoff } from '../src/migration/xiaowei-research-handoff.js'

const statePath = await resolveStatePath(process.argv.find(value => value.startsWith('--state='))?.slice('--state='.length))
const [stateBytes, configBytes, stateInfo] = await Promise.all([readFile(statePath, 'utf8'), readFile(resolve(dirname(statePath), 'config.json'), 'utf8'), stat(statePath)])
const config = JSON.parse(configBytes) as Record<string, unknown>
const agent = typeof config.xiaoweiAgent === 'object' && config.xiaoweiAgent !== null ? config.xiaoweiAgent as Record<string, unknown> : {}
if (typeof agent.openId !== 'string' || typeof agent.chatId !== 'string') throw new Error('compat config has no Xiaowei identity')
const handoff = prepareXiaoweiResearchHandoff(JSON.parse(stateBytes), { agentName: typeof agent.name === 'string' ? agent.name : undefined,
  agentOpenId: agent.openId, agentChatId: agent.chatId, retryBaseMs: 120_000, retryMaxMs: 3_600_000 }, stateInfo.mtime.toISOString())
process.stdout.write(`${JSON.stringify({ statePath, mode: 'read-only', ...handoff.counts, workflows: handoff.workflows.length,
  agentHash: createHash('sha256').update(`${agent.openId}:${agent.chatId}`).digest('hex').slice(0, 16), digest: handoff.digest }, null, 2)}\n`)
async function exists(path: string) { return await access(path).then(() => true, () => false) }
async function resolveStatePath(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit)
  const root = resolve('var/handoff'); const values = await Promise.all((await readdir(root, { withFileTypes: true })).filter(x => x.isDirectory()).map(async x => {
    const path = resolve(root, x.name, 'state.json'); return await exists(path) ? { path, mtime: (await stat(path)).mtimeMs } : undefined
  })); const latest = values.filter(x => x !== undefined).sort((a, b) => b.mtime - a.mtime)[0]
  if (!latest) throw new Error('no managed compatibility state.json found; pass --state=/absolute/path')
  return latest.path
}
