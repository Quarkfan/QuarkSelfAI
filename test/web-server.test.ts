import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ConsoleServerConfig } from '../src/web/config.js'
import { createSqliteStore } from '../src/storage/sqlite.js'
import { createConsoleServer } from '../src/web/server.js'
import type { RuntimeSnapshot } from '../src/platform/operations.js'
import { loadNativeCutoverReadiness } from '../src/config/feature-parity.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))

test('serves a visible dashboard and reports the blocked takeover gate', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-web-'))
  const store = await createSqliteStore(join(directory, 'web.sqlite3'), migrations)
  await store.migrate()
  const config: ConsoleServerConfig = {
    execution: { mode: 'local', workspaceRoots: [directory] },
    web: { host: '127.0.0.1', port: 3210, secureCookie: false },
    controlPlane: { token: 'control-test-token' },
  }
  let worker: RuntimeSnapshot = { mode: 'control-only', state: 'stopped', capabilities: [] }
  const server = createConsoleServer(store, config, { snapshot: () => worker }, undefined, { inspect: loadNativeCutoverReadiness })
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
    const payload = await response.json() as { ok: boolean; data: { readiness: { id: string; state: string } } }
    assert.equal(payload.ok, true)
    assert.equal(payload.data.readiness.id, 'native-cutover')
    assert.equal(payload.data.readiness.state, 'blocked')
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
    const evaluationResponse = await fetch(`http://127.0.0.1:${port}/internal/policies/evaluate`, {
      method: 'POST',
      headers: { authorization: 'Bearer control-test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ facts: { source: { senderId: 'ou_ren' }, urgency: 'normal' } }),
    })
    assert.equal(evaluationResponse.status, 200)
    const evaluation = await evaluationResponse.json() as { evaluation: { effect: { attention?: string }; matches: unknown[] } }
    assert.equal(evaluation.evaluation.effect.attention, 'realtime')
    assert.equal(evaluation.evaluation.matches.length, 1)
    const workRecord = {
      version: 1, day: '2026-09-02', headline: '完成工作账本能力', highlights: [], decisions: [],
      deliverables: ['工作账本'], collaboration: [], nextSteps: [], sources: [], gaps: [],
    }
    await store.appendSignal({
      id: 'work-journal:daily:2026-09-02', kind: 'assistant.work-journal.daily.v1',
      occurredAt: '2026-09-02T23:59:59.999+08:00', scope: { day: '2026-09-02' }, data: workRecord,
    })
    const journalQuery = await fetch(`http://127.0.0.1:${port}/internal/work-journal/query`, {
      method: 'POST', headers: { authorization: 'Bearer control-test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ from: '2026-09-01', to: '2026-09-03' }),
    })
    const journal = await journalQuery.json() as { result: { count: number; records: { day: string }[] } }
    assert.equal(journal.result.count, 1)
    assert.equal(journal.result.records[0]?.day, '2026-09-02')
    const dashboardResponse = await fetch(`http://127.0.0.1:${port}/api/dashboard`)
    const dashboardPayload = await dashboardResponse.json() as { data: { workJournal: { day: string }[] } }
    assert.equal(dashboardPayload.data.workJournal[0]?.day, '2026-09-02')
    worker = { mode: 'compat', state: 'failed', capabilities: [], lastError: 'fixture failure' }
    const unhealthy = await fetch(`http://127.0.0.1:${port}/api/health`)
    assert.equal(unhealthy.status, 503)
  } finally {
    server.close()
    await once(server, 'close')
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('reports an accepted-risk cutover without falsifying feature parity', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-web-cutover-'))
  const store = await createSqliteStore(join(directory, 'web.sqlite3'), migrations)
  await store.migrate()
  const config: ConsoleServerConfig = {
    execution: { mode: 'local', workspaceRoots: [directory] },
    web: { host: '127.0.0.1', port: 3210, secureCookie: false },
    controlPlane: { token: 'control-test-token' },
  }
  const worker: RuntimeSnapshot = {
    mode: 'compat', operationalMode: 'accepted-risk-cutover',
    state: 'ready', capabilities: [
      { id: 'channel-event:message', required: true, state: 'ready' },
      { id: 'channel-event:interaction', required: true, state: 'ready' },
    ],
  }
  const server = createConsoleServer(store, config, { snapshot: () => worker }, undefined, { inspect: loadNativeCutoverReadiness })
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
  try {
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/health`)
    const payload = await response.json() as { readiness: { id: string; state: string }; operationalMode: string }
    assert.equal(response.status, 200)
    assert.equal(payload.readiness.id, 'native-cutover')
    assert.equal(payload.readiness.state, 'blocked')
    assert.equal(payload.operationalMode, 'accepted-risk-cutover')
  } finally {
    server.close()
    await once(server, 'close')
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
