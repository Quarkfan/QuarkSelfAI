import { chmod, lstat, realpath, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { MAX_DEVICE_FRAME_BYTES } from '../client-runtime/device-codec.js'
import { exactPortableUnixSocketPathV1 } from '../client-runtime/unix-socket-path.js'
import type { PreparedCloudTransportHostV1 } from './cloud-transport-host.js'

export interface CloudSshIpcConfigV1 { readonly schemaVersion: 1; readonly enabled: true; readonly socketPath: string; readonly requestTimeoutMs: number; readonly providerOwnership: 'shared-host'; readonly externalEffectsEnabled: false }
export interface CloudSshIpcBridgeV1 { readonly socketPath: string; readonly mode: 'owner-only'; requestCount(): number; close(): Promise<void> }

/** Removes only an owner-only, unresponsive socket after the process lease proved its prior owner is dead. */
export async function reconcileStaleCloudSshIpcSocketV1(pathInput: string): Promise<'absent' | 'removed'> {
  let path: string; try { path = exactPortableUnixSocketPathV1(pathInput) } catch { throw new Error('stale cloud SSH IPC path is invalid') }
  const state = await lstat(path).catch(error => hasCode(error, 'ENOENT') ? undefined : Promise.reject(error)); if (!state) return 'absent'
  const uid = process.getuid?.(); if (!state.isSocket() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || (uid !== undefined && state.uid !== uid)) throw new Error('stale cloud SSH IPC socket is unsafe')
  if (await acceptsConnections(path)) throw new Error('cloud SSH IPC socket is still active')
  const current = await lstat(path).catch(error => hasCode(error, 'ENOENT') ? undefined : Promise.reject(error)); if (!current) return 'absent'
  if (!current.isSocket() || current.dev !== state.dev || current.ino !== state.ino || current.uid !== state.uid || current.mode !== state.mode) throw new Error('stale cloud SSH IPC socket identity changed')
  await unlink(path); return 'removed'
}

/** Private local bridge for an sshd subsystem proxy. The canonical cloud host remains the only provider owner. */
export async function openCloudSshIpcBridgeV1(value: unknown, host: Pick<PreparedCloudTransportHostV1, 'handleSshFrame'>): Promise<CloudSshIpcBridgeV1> {
  const config = await validate(value); let requests = 0; const sockets = new Set<Socket>()
  const server = createServer({ allowHalfOpen: true }, socket => { requests += 1; sockets.add(socket); socket.once('close', () => sockets.delete(socket)); serve(socket, host, config.requestTimeoutMs) })
  try { await listen(server, config.socketPath); await chmod(config.socketPath, 0o600) } catch (error) { try { server.close() } catch {}; throw error }
  const created = await lstat(config.socketPath)
  if (!created.isSocket() || created.isSymbolicLink() || (created.mode & 0o077) !== 0) { await closeServer(server, sockets); throw new Error('cloud SSH IPC socket is unsafe') }
  return Object.freeze({ socketPath: config.socketPath, mode: 'owner-only', requestCount: () => requests, close: async () => {
    await closeServer(server, sockets); const current = await lstat(config.socketPath).catch(() => undefined)
    if (current && current.dev === created.dev && current.ino === created.ino && current.isSocket()) await unlink(config.socketPath)
    else if (current) throw new Error('cloud SSH IPC socket identity changed')
  } })
}

async function validate(value: unknown): Promise<CloudSshIpcConfigV1> {
  if (!isRecord(value)) throw new Error('cloud SSH IPC config is invalid'); const keys = ['schemaVersion', 'enabled', 'socketPath', 'requestTimeoutMs', 'providerOwnership', 'externalEffectsEnabled']
  let socketPath: string; try { socketPath = exactPortableUnixSocketPathV1(value.socketPath) } catch { throw new Error('cloud SSH IPC config is invalid') }
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || value.enabled !== true || !Number.isSafeInteger(value.requestTimeoutMs) || (value.requestTimeoutMs as number) < 1_000 || (value.requestTimeoutMs as number) > 30_000 || value.providerOwnership !== 'shared-host' || value.externalEffectsEnabled !== false) throw new Error('cloud SSH IPC config is invalid')
  const root = dirname(socketPath); const state = await lstat(root); const uid = process.getuid?.()
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(root) !== root || (uid !== undefined && state.uid !== uid)) throw new Error('cloud SSH IPC root is unsafe')
  try { await lstat(socketPath); throw new Error('cloud SSH IPC socket path already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return value as unknown as CloudSshIpcConfigV1
}
function serve(socket: Socket, host: Pick<PreparedCloudTransportHostV1, 'handleSshFrame'>, timeoutMs: number): void {
  const chunks: Buffer[] = []; let size = 0; socket.setTimeout(timeoutMs, () => socket.destroy())
  socket.on('data', chunk => { size += chunk.byteLength; if (size > MAX_DEVICE_FRAME_BYTES + 4) socket.destroy(); else chunks.push(Buffer.from(chunk)) })
  socket.on('end', () => { if (!size || size > MAX_DEVICE_FRAME_BYTES + 4) return socket.destroy(); host.handleSshFrame(Buffer.concat(chunks)).then(response => socket.end(response), () => socket.destroy()) })
  socket.on('error', () => undefined)
}
function listen(server: Server, path: string): Promise<void> { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); resolve() }) }) }
function acceptsConnections(path: string): Promise<boolean> { return new Promise((resolveProbe, rejectProbe) => { let settled = false; const socket = createConnection(path); const timer = setTimeout(() => finish(new Error('stale cloud SSH IPC liveness probe timed out')), 500); const finish = (error?: Error, active?: boolean): void => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? rejectProbe(error) : resolveProbe(Boolean(active)) }; socket.once('connect', () => finish(undefined, true)); socket.once('error', error => { const code = (error as NodeJS.ErrnoException).code; if (code === 'ECONNREFUSED' || code === 'ENOENT') finish(undefined, false); else finish(new Error('stale cloud SSH IPC liveness probe failed')) }) }) }
function closeServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> { return new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); for (const socket of sockets) socket.destroy() }) }
function hasCode(error: unknown, code: string): boolean { return error !== null && typeof error === 'object' && 'code' in error && error.code === code }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
