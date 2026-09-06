import { chmod, lstat, realpath, unlink } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname, isAbsolute, resolve } from 'node:path'
import { MAX_DEVICE_FRAME_BYTES } from '../client-runtime/device-codec.js'
import type { PreparedCloudTransportHostV1 } from './cloud-transport-host.js'

export interface CloudSshIpcConfigV1 { readonly schemaVersion: 1; readonly enabled: true; readonly socketPath: string; readonly requestTimeoutMs: number; readonly providerOwnership: 'shared-host'; readonly externalEffectsEnabled: false }
export interface CloudSshIpcBridgeV1 { readonly socketPath: string; readonly mode: 'owner-only'; requestCount(): number; close(): Promise<void> }

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
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || value.enabled !== true || typeof value.socketPath !== 'string' || !isAbsolute(value.socketPath) || resolve(value.socketPath) !== value.socketPath || /[\r\n\0]/.test(value.socketPath) || !Number.isSafeInteger(value.requestTimeoutMs) || (value.requestTimeoutMs as number) < 1_000 || (value.requestTimeoutMs as number) > 30_000 || value.providerOwnership !== 'shared-host' || value.externalEffectsEnabled !== false) throw new Error('cloud SSH IPC config is invalid')
  const root = dirname(value.socketPath); const state = await lstat(root); const uid = process.getuid?.()
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(root) !== root || (uid !== undefined && state.uid !== uid)) throw new Error('cloud SSH IPC root is unsafe')
  try { await lstat(value.socketPath); throw new Error('cloud SSH IPC socket path already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return value as unknown as CloudSshIpcConfigV1
}
function serve(socket: Socket, host: Pick<PreparedCloudTransportHostV1, 'handleSshFrame'>, timeoutMs: number): void {
  const chunks: Buffer[] = []; let size = 0; socket.setTimeout(timeoutMs, () => socket.destroy())
  socket.on('data', chunk => { size += chunk.byteLength; if (size > MAX_DEVICE_FRAME_BYTES + 4) socket.destroy(); else chunks.push(Buffer.from(chunk)) })
  socket.on('end', () => { if (!size || size > MAX_DEVICE_FRAME_BYTES + 4) return socket.destroy(); host.handleSshFrame(Buffer.concat(chunks)).then(response => socket.end(response), () => socket.destroy()) })
  socket.on('error', () => undefined)
}
function listen(server: Server, path: string): Promise<void> { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); resolve() }) }) }
function closeServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> { return new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); for (const socket of sockets) socket.destroy() }) }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
