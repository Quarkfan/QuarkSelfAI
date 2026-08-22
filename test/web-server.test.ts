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
    lark: { executable: 'lark-cli', identity: 'bot' },
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
  } finally {
    server.close()
    await once(server, 'close')
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
