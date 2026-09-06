import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

interface ServerLeaseOwnerV1 { readonly schemaVersion: 1; readonly pid: number; readonly token: string; readonly createdAt: string }

/** Owns the right to open one installed server provider graph. */
export class InstalledServerInstanceLeaseV1 {
  #released = false
  private constructor(private readonly path: string, private readonly owner: ServerLeaseOwnerV1) {}

  static async acquire(pathInput: string, now = new Date()): Promise<InstalledServerInstanceLeaseV1> {
    if (!isAbsolute(pathInput) || resolve(pathInput) !== pathInput || pathInput === '/' || Number.isNaN(now.getTime())) throw new Error('server instance lease input is invalid')
    const parent = await privateDirectory(dirname(pathInput)); const path = join(parent, basename(pathInput)); const owner = Object.freeze({ schemaVersion: 1 as const, pid: process.pid, token: randomUUID(), createdAt: now.toISOString() })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await mkdir(path, { mode: 0o700 })
        try { await writeOwner(join(path, 'owner.json'), owner) } catch (error) { await cleanupCreatedLease(path, owner); throw error }
        return new InstalledServerInstanceLeaseV1(path, owner)
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
        const current = await readOwner(path); if (alive(current.pid)) throw new Error('another installed server instance owns the provider graph')
        const stale = `${path}.stale.${randomUUID()}`
        try { await rename(path, stale); await removeExactLease(stale) } catch (reclaimError) { if (!hasCode(reclaimError, 'ENOENT')) throw reclaimError }
      }
    }
    throw new Error('could not acquire installed server instance lease')
  }

  async release(): Promise<void> {
    if (this.#released) return
    const current = await readOwner(this.path); if (current.pid !== this.owner.pid || current.token !== this.owner.token) throw new Error('server instance lease ownership drifted')
    await removeExactLease(this.path); this.#released = true
  }
}

async function privateDirectory(value: string): Promise<string> { const canonical = await realpath(value); const state = await lstat(canonical); const uid = process.getuid?.(); if (canonical !== value || !state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || (uid !== undefined && state.uid !== uid)) throw new Error('server instance lease parent is unsafe'); return canonical }
async function writeOwner(path: string, owner: ServerLeaseOwnerV1): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(`${JSON.stringify(owner)}\n`); await handle.sync() } finally { await handle.close() } }
async function readOwner(path: string): Promise<ServerLeaseOwnerV1> { try { await privateLeaseLayout(path); const value = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')) as unknown; if (!record(value) || Object.keys(value).sort().join(',') !== 'createdAt,pid,schemaVersion,token' || value.schemaVersion !== 1 || !Number.isSafeInteger(value.pid) || (value.pid as number) <= 0 || typeof value.token !== 'string' || !/^[0-9a-f-]{36}$/.test(value.token) || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) throw new Error('invalid'); return value as unknown as ServerLeaseOwnerV1 } catch { throw new Error('existing server instance lease is invalid') } }
async function privateLeaseLayout(path: string): Promise<void> { const directory = await lstat(path); const owner = await lstat(join(path, 'owner.json')); const uid = process.getuid?.(); if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 || await realpath(path) !== path || (uid !== undefined && directory.uid !== uid) || !owner.isFile() || owner.isSymbolicLink() || owner.nlink !== 1 || (owner.mode & 0o077) !== 0 || owner.size <= 0 || owner.size > 4096 || (uid !== undefined && owner.uid !== uid) || await realpath(join(path, 'owner.json')) !== join(path, 'owner.json')) throw new Error('invalid'); if ((await readdir(path)).join(',') !== 'owner.json') throw new Error('invalid') }
async function removeExactLease(path: string): Promise<void> { await privateLeaseLayout(path); await unlink(join(path, 'owner.json')); await rmdir(path) }
async function cleanupCreatedLease(path: string, owner: ServerLeaseOwnerV1): Promise<void> { try { const entries = await readdir(path); if (entries.length === 0) { await rmdir(path); return }; if (entries.join(',') !== 'owner.json') return; const expected = `${JSON.stringify(owner)}\n`; if (await readFile(join(path, 'owner.json'), 'utf8') !== expected) return; await removeExactLease(path) } catch { /* Preserve the original creation error and any ambiguous state. */ } }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' } }
function hasCode(error: unknown, code: string): boolean { return error !== null && typeof error === 'object' && 'code' in error && error.code === code }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
