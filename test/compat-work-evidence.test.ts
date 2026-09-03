import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CompatStateWorkEvidenceProvider } from '../src/runtime/compat-work-evidence.js'

test('reads bounded work evidence from the compatibility snapshot without owning the journal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-work-evidence-'))
  try {
    await writeFile(join(directory, 'config.json'), JSON.stringify({ varDir: directory }))
    await writeFile(join(directory, 'state.json'), JSON.stringify({
      ownerConversation: [
        { messageId: 'm1', receivedAt: '2026-09-02T02:00:00.000Z', content: '推进昨天的事项' },
        { messageId: 'm2', receivedAt: '2026-09-03T02:00:00.000Z', content: '今天的事项' },
      ],
      shadowMatters: [{ key: 'matter-1', title: '工作事项', updatedAt: '2026-09-02T08:00:00.000Z' }],
    }))
    const evidence = await new CompatStateWorkEvidenceProvider(join(directory, 'config.json')).load('2026-09-02')
    assert.equal((evidence.ownerMessages as unknown[]).length, 1)
    assert.equal((evidence.matters as unknown[]).length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
