import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const configPath = process.env.COMPAT_CONFIG_PATH
if (!configPath) throw new Error('COMPAT_CONFIG_PATH is required')
const config = JSON.parse(await readFile(configPath, 'utf8'))
if (typeof config.varDir !== 'string' || !config.varDir) throw new Error('compat config must define varDir')
const statePath = join(config.varDir, 'state.json')
const state = JSON.parse(await readFile(statePath, 'utf8'))
if ((state.queue?.length ?? 0) !== 0 || (state.mentionPending?.length ?? 0) !== 0) {
  throw new Error('refusing to prune while command or focus-message queues are non-empty')
}
const before = {}
const retain = (key, predicate) => {
  const current = Array.isArray(state[key]) ? state[key] : []
  before[key] = current.length
  state[key] = current.filter(predicate)
}
retain('mentionResearchSessions', (item) => !item?.deletedAt)
retain('mentionResearchConfirmations', (item) => item?.status === 'pending')
retain('xiaoweiResearchRequests', (item) => !['completed', 'declined', 'cancelled', 'failed'].includes(item?.status))
retain('followupOutreachRequests', (item) => !['completed', 'declined', 'cancelled', 'failed'].includes(item?.status))
retain('claudeFallbackSessions', (item) => !['completed', 'declined', 'cancelled', 'failed'].includes(item?.status))
before.researchDecisionHistory = Array.isArray(state.researchDecisionHistory) ? state.researchDecisionHistory.length : 0
state.researchDecisionHistory = []
const temporary = `${statePath}.prune.tmp`
await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
await rename(temporary, statePath)
const after = Object.fromEntries(Object.keys(before).map((key) => [key, state[key]?.length ?? 0]))
process.stdout.write(`${JSON.stringify({ ok: true, statePath, before, after, dedupeCheckpointsPreserved: true, activeShadowWindowPreserved: Boolean(state.shadowMode?.enabled) }, null, 2)}\n`)
