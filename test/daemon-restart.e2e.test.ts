import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSqliteStore } from '../src/storage/sqlite.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))
const app = fileURLToPath(new URL('../dist/app.js', import.meta.url))

async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  server.close()
  await once(server, 'close')
  return port
}

async function startDaemon(database: string, workspace: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [app], {
    cwd: workspace,
    env: {
      ...process.env,
      ASSISTANT_RUNTIME: 'control-only',
      ASSISTANT_KERNEL: 'off',
      ASSISTANT_EXECUTION_MODE: 'local',
      ASSISTANT_WORKSPACE_ROOTS: JSON.stringify([workspace]),
      SQLITE_PATH: database,
      WEB_HOST: '127.0.0.1',
      WEB_PORT: String(port),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const check = (): void => {
          if (output.includes('QuarkSelfAI console ready')) resolve()
          else if (child.exitCode !== null) reject(new Error(`daemon exited during startup: ${output}`))
          else setTimeout(check, 10)
        }
        check()
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`daemon startup timed out: ${output}`)), 10_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  return child
}

async function stopDaemon(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.kill('SIGTERM')
  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]
  assert.equal(signal, null)
  assert.equal(code, 0)
}

test('control daemon preserves SQLite state across a real process restart', async (context) => {
  let port: number
  try {
    port = await availablePort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('sandbox does not permit loopback listeners')
      return
    }
    throw error
  }
  const directory = await mkdtemp(join(tmpdir(), 'quark-daemon-restart-'))
  const database = join(directory, 'assistant.sqlite3')
  const store = await createSqliteStore(database, migrations)
  await store.migrate()
  await store.appendEvent('restart-event', {
    kind: 'channel.event',
    source: { channel: 'feishu', eventId: 'restart-fixture' },
    eventKey: 'fixture.restart',
    deduplicationKey: 'fixture.restart',
    payload: {},
    raw: {},
  })
  await store.close()
  try {
    for (let generation = 1; generation <= 2; generation += 1) {
      const child = await startDaemon(database, directory, port)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`)
        assert.equal(response.status, 200)
        const payload = await response.json() as { data: { overview: { events: number }; runtime: { worker: { mode: string } } } }
        assert.equal(payload.data.overview.events, 1)
        assert.equal(payload.data.runtime.worker.mode, 'control-only')
      } finally {
        await stopDaemon(child)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
