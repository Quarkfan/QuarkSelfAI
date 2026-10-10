import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { recoverInactiveClientInstallation } from './client-installation.js'
import type { InstalledClientProcessSnapshotV1 } from './installed-client-process.js'

export interface InstalledClientProcessHealthReceiptV1 {
  readonly schemaVersion: 1
  readonly installationId: string
  readonly clientVersion: string
  readonly pid: number
  readonly readyAt: string
  readonly state: 'ready-effects-off'
  readonly workerState: 'running' | 'degraded'
  readonly singleClientOwner: true
  readonly externalWritesEnabled: false
}

/** Publishes bounded local readiness only after the installed owner has started. */
export async function publishInstalledClientProcessHealthV1(installRoot: string, snapshot: InstalledClientProcessSnapshotV1, now = new Date(), pid = process.pid): Promise<InstalledClientProcessHealthReceiptV1> {
  const root = exactRoot(installRoot); if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(pid) || pid < 1 || !['running', 'degraded'].includes(snapshot.worker.state)) throw new Error('client process health input is invalid')
  const installation = await recoverInactiveClientInstallation(root)
  if (snapshot.installationId !== installation.receipt.installationId || snapshot.clientVersion !== installation.receipt.clientVersion || snapshot.externalWritesEnabled !== false) throw new Error('client process health lineage drifted')
  const receipt = Object.freeze({ schemaVersion: 1 as const, installationId: snapshot.installationId, clientVersion: snapshot.clientVersion, pid, readyAt: now.toISOString(), state: 'ready-effects-off' as const, workerState: snapshot.worker.state as 'running' | 'degraded', singleClientOwner: true as const, externalWritesEnabled: false as const })
  await writePrivate(healthPath(root), Buffer.from(`${JSON.stringify(receipt)}\n`)); return receipt
}

export async function recoverInstalledClientProcessHealthV1(installRoot: string): Promise<InstalledClientProcessHealthReceiptV1> {
  const root = exactRoot(installRoot); const installation = await recoverInactiveClientInstallation(root); const receipt = exactReceipt(JSON.parse((await readPrivate(healthPath(root))).toString('utf8')))
  if (receipt.installationId !== installation.receipt.installationId || receipt.clientVersion !== installation.receipt.clientVersion) throw new Error('client process health lineage drifted')
  return receipt
}

/** Removes only the exact health record owned by the stopped process. */
export async function removeInstalledClientProcessHealthV1(installRoot: string, expectedPid: number): Promise<void> {
  const receipt = await recoverInstalledClientProcessHealthV1(installRoot); if (receipt.pid !== expectedPid) throw new Error('client process health owner drifted'); await unlink(healthPath(installRoot))
}

function exactRoot(value: string): string { if (!isAbsolute(value) || resolve(value) !== value || value === '/') throw new Error('client process health root is invalid'); return value }
function healthPath(root: string): string { return join(root, 'runtime/client-process-health.json') }
function exactReceipt(value: unknown): InstalledClientProcessHealthReceiptV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client process health receipt is invalid'); const item = value as Record<string, unknown>; const keys = ['schemaVersion','installationId','clientVersion','pid','readyAt','state','workerState','singleClientOwner','externalWritesEnabled']; if (Object.keys(item).sort().join(',') !== keys.sort().join(',') || item.schemaVersion !== 1 || typeof item.installationId !== 'string' || !/^installation\.[a-f0-9]{32}$/.test(item.installationId) || typeof item.clientVersion !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(item.clientVersion) || !Number.isSafeInteger(item.pid) || Number(item.pid) < 1 || typeof item.readyAt !== 'string' || Number.isNaN(Date.parse(item.readyAt)) || item.state !== 'ready-effects-off' || !['running','degraded'].includes(String(item.workerState)) || item.singleClientOwner !== true || item.externalWritesEnabled !== false) throw new Error('client process health receipt is invalid'); return Object.freeze(item as unknown as InstalledClientProcessHealthReceiptV1) }
async function readPrivate(path: string): Promise<Buffer> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || state.size < 1 || state.size > 64 * 1024 || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('client process health file is unsafe'); return await readFile(path) }
async function writePrivate(path: string, bytes: Uint8Array): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
