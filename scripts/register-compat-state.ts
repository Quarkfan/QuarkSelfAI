import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadRuntimeConfig } from '../src/config/runtime.js'
import { createAssistantStore } from '../src/storage/factory.js'

const config = loadRuntimeConfig()
if (config.runtime.mode !== 'compat') throw new Error('compat runtime is required')
const compatConfig = JSON.parse(await readFile(config.runtime.configPath, 'utf8')) as { varDir?: unknown }
if (typeof compatConfig.varDir !== 'string') throw new Error('compat config must define varDir')
const contents = await readFile(join(compatConfig.varDir, 'state.json'))
const state = JSON.parse(contents.toString('utf8')) as Record<string, unknown>
const count = (key: string): number => Array.isArray(state[key]) ? state[key].length : 0
const cursor = {
  version: 1,
  sha256: createHash('sha256').update(contents).digest('hex'),
  importedAt: new Date().toISOString(),
  active: {
    commands: count('queue'),
    focusMessages: count('mentionPending'),
    researchSessions: count('mentionResearchSessions'),
    researchApprovals: count('mentionResearchConfirmations'),
    xiaoweiRequests: count('xiaoweiResearchRequests'),
    followupOutreach: count('followupOutreachRequests'),
  },
  deduplication: {
    ownerMessages: count('processedMessageIds'),
    focusMessages: count('mentionProcessedMessageIds'),
    cardEvents: count('processedCardEventIds'),
    xiaoweiMessages: count('xiaoweiProcessedMessageIds'),
  },
  completedRecordsExcluded: true,
  activePayloadSource: 'quarkselfai-managed-compat-state',
}
const store = await createAssistantStore(config)
try {
  await store.updateCheckpoint('compatibility-handoff', 'state.json', cursor)
} finally {
  await store.close()
}
process.stdout.write(`${JSON.stringify({ ok: true, storage: config.storage.kind, ...cursor }, null, 2)}\n`)
