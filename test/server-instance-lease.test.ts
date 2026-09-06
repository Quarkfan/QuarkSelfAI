import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { InstalledServerInstanceLeaseV1 } from '../src/control-plane/server-instance-lease.js'

test('permits exactly one installed server provider owner and releases only its own lease', async () => {
  const root = await privateRoot(); const path = join(root, 'instance')
  try { const first = await InstalledServerInstanceLeaseV1.acquire(path, new Date('2026-09-06T00:00:00.000Z')); await assert.rejects(InstalledServerInstanceLeaseV1.acquire(path), /another installed server/); await first.release(); await assert.rejects(lstat(path), missing); const next = await InstalledServerInstanceLeaseV1.acquire(path); await next.release() } finally { await rm(root, { recursive: true, force: true }) }
})

test('reclaims only a structurally valid lease whose process is gone', async () => {
  const root = await privateRoot(); const path = join(root, 'instance')
  try { await mkdir(path, { mode: 0o700 }); await writeFile(join(path, 'owner.json'), `${JSON.stringify({ schemaVersion: 1, pid: 2_147_483_647, token: '00000000-0000-4000-8000-000000000000', createdAt: '2026-09-06T00:00:00.000Z' })}\n`, { mode: 0o600 }); const lease = await InstalledServerInstanceLeaseV1.acquire(path); await lease.release(); await assert.rejects(lstat(path), missing) } finally { await rm(root, { recursive: true, force: true }) }
})

test('never guesses or removes malformed stale lease state', async () => {
  const root = await privateRoot(); const path = join(root, 'instance')
  try { await mkdir(path, { mode: 0o700 }); await writeFile(join(path, 'owner.json'), '{}\n', { mode: 0o600 }); await writeFile(join(path, 'unknown'), 'retain\n', { mode: 0o600 }); await assert.rejects(InstalledServerInstanceLeaseV1.acquire(path), /existing server instance lease is invalid/); assert.equal(await readFile(join(path, 'unknown'), 'utf8'), 'retain\n') } finally { await rm(root, { recursive: true, force: true }) }
})

async function privateRoot(): Promise<string> { const path = await realpath(await mkdtemp(join(tmpdir(), 'quark-server-lease-'))); await chmod(path, 0o700); return path }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
