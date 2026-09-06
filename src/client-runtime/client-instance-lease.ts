import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

interface LeaseOwnerV1 { readonly schemaVersion: 1; readonly pid: number; readonly token: string; readonly createdAt: string }

/** One local composition owner. A directory rename makes stale-owner recovery race-safe. */
export class LocalClientInstanceLeaseV1 {
  private released = false
  private constructor(private readonly path: string, private readonly owner: LeaseOwnerV1) {}

  static async acquire(pathInput: string, now = new Date()): Promise<LocalClientInstanceLeaseV1> {
    if (!isAbsolute(pathInput) || Number.isNaN(now.getTime())) throw new Error('client instance lease path or timestamp is invalid')
    const requested = resolve(pathInput); const requestedParent = dirname(requested)
    await mkdir(requestedParent, { recursive: true, mode: 0o700 })
    const parent = await realpath(requestedParent); const path = join(parent, basename(requested))
    const owner = Object.freeze({ schemaVersion: 1 as const, pid: process.pid, token: randomUUID(), createdAt: now.toISOString() })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await mkdir(path, { mode: 0o700 })
        try { await writeFile(resolve(path, 'owner.json'), `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 }) }
        catch (error) { await rm(path, { recursive: true, force: true }); throw error }
        return new LocalClientInstanceLeaseV1(path, owner)
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
        const current = await readOwner(path)
        if (isProcessAlive(current.pid)) throw new Error('another local client instance owns the state')
        const stale = `${path}.stale.${randomUUID()}`
        try { await rename(path, stale); await rm(stale, { recursive: true, force: true }) }
        catch (reclaimError) { if (!hasCode(reclaimError, 'ENOENT')) throw reclaimError }
      }
    }
    throw new Error('could not acquire the local client instance lease')
  }

  async release(): Promise<void> {
    if (this.released) return
    const current = await readOwner(this.path)
    if (current.token !== this.owner.token || current.pid !== this.owner.pid) throw new Error('local client instance lease ownership drifted')
    await rm(this.path, { recursive: true })
    this.released = true
  }
}

async function readOwner(path: string): Promise<LeaseOwnerV1> {
  let value: unknown
  try {
    const directory = await lstat(path); const ownerPath = resolve(path, 'owner.json'); const owner = await lstat(ownerPath)
    if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(path) !== path || !owner.isFile() || owner.isSymbolicLink()) throw new Error('unsafe lease')
    value = JSON.parse(await readFile(ownerPath, 'utf8'))
  } catch { throw new Error('existing client instance lease is unreadable') }
  const item = value as Partial<LeaseOwnerV1>
  if (item.schemaVersion !== 1 || !Number.isSafeInteger(item.pid) || Number(item.pid) <= 0 || typeof item.token !== 'string' || !/^[0-9a-f-]{36}$/.test(item.token) || typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))) throw new Error('existing client instance lease is invalid')
  return item as LeaseOwnerV1
}
function isProcessAlive(pid: number): boolean { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' } }
function hasCode(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === code }
