import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { RuntimeConfig } from '../src/config/runtime.js'
import { createSqliteStore } from '../src/storage/sqlite.js'
import { createConsoleServer } from '../src/web/server.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))

test('serves a visible dashboard and reports the blocked takeover gate', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-web-'))
  const store = await createSqliteStore(join(directory, 'web.sqlite3'), migrations)
  await store.migrate()
  const config: RuntimeConfig = {
    storage: { kind: 'sqlite', path: join(directory, 'web.sqlite3') },
    web: { host: '127.0.0.1', port: 3210, secureCookie: false },
    controlPlane: { token: 'control-test-token' },
    lark: { executable: 'lark-cli', identity: 'bot' },
    runtime: { mode: 'control-only' },
  }
  const server = createConsoleServer(store, config)
  server.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('sandbox does not permit loopback listeners')
      await store.close()
      await rm(directory, { recursive: true, force: true })
      return
    }
    throw error
  }
  const port = (server.address() as AddressInfo).port
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /QuarkSelfAI · Control Room/)
    const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`)
    const payload = await response.json() as { ok: boolean; data: { parity: { takeoverReady: boolean } } }
    assert.equal(payload.ok, true)
    assert.equal(payload.data.parity.takeoverReady, false)
    const unauthorized = await fetch(`http://127.0.0.1:${port}/internal/policies/proposals`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(unauthorized.status, 401)
    const sourceText = '任永强发来的消息实时提醒'
    const document = {
      version: 1,
      name: '任永强消息实时提醒',
      description: '重点联系人消息保持实时',
      priority: 500,
      when: { fact: 'source.senderId', op: 'eq', value: 'ou_ren' },
      effect: { attention: 'realtime' },
    }
    const proposalResponse = await fetch(`http://127.0.0.1:${port}/internal/policies/proposals`, {
      method: 'POST',
      headers: { authorization: 'Bearer control-test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ sourceText, document }),
    })
    assert.equal(proposalResponse.status, 201)
    const proposalPayload = await proposalResponse.json() as { proposal: { id: string; revision: number; simulation: { safeToActivate: boolean } } }
    assert.equal(proposalPayload.proposal.simulation.safeToActivate, true)
    const activationResponse = await fetch(
      `http://127.0.0.1:${port}/internal/policies/${proposalPayload.proposal.id}/revisions/${proposalPayload.proposal.revision}/activate`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer control-test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ ownerConfirmed: true }),
      },
    )
    assert.equal(activationResponse.status, 200)
    assert.equal((await store.policies(10))[0]?.status, 'enabled')
  } finally {
    server.close()
    await once(server, 'close')
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
