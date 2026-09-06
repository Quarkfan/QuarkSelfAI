import { createConnection, type Socket } from 'node:net'
import { MAX_DEVICE_FRAME_BYTES } from './device-codec.js'
import { exactPortableUnixSocketPathV1 } from './unix-socket-path.js'

/** Exchanges one bounded frame with the process-local cloud host. It cannot open a provider or a remote connection. */
export function proxySshSubsystemFrameV1(socketPath: string, request: Buffer, timeoutMs = 5_000): Promise<Buffer> {
  try { exactPortableUnixSocketPathV1(socketPath) } catch { throw new Error('SSH subsystem IPC proxy input is invalid') }
  if (!Buffer.isBuffer(request) || !request.byteLength || request.byteLength > MAX_DEVICE_FRAME_BYTES + 4 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) throw new Error('SSH subsystem IPC proxy input is invalid')
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = []; let size = 0; let settled = false; const socket = createConnection(socketPath)
    const finish = (error?: Error) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : accept(Buffer.concat(chunks)) }
    socket.setTimeout(timeoutMs, () => finish(new Error('SSH subsystem IPC proxy timed out')))
    socket.once('connect', () => socket.end(request)); socket.on('data', chunk => { size += chunk.byteLength; if (size > MAX_DEVICE_FRAME_BYTES + 4) finish(new Error('SSH subsystem IPC response is too large')); else chunks.push(Buffer.from(chunk)) })
    socket.once('end', () => chunks.length ? finish() : finish(new Error('SSH subsystem IPC response is missing'))); socket.once('error', () => finish(new Error('SSH subsystem IPC is unavailable')))
  })
}
