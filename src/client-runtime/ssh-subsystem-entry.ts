import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_DEVICE_FRAME_BYTES } from './device-codec.js'
import { proxySshSubsystemFrameV1 } from './ssh-subsystem-ipc-proxy.js'
import { exactPortableUnixSocketPathV1 } from './unix-socket-path.js'

interface SshSubsystemEntryConfigV1 { readonly schemaVersion: 1; readonly socketPath: string; readonly timeoutMs: number; readonly providerOwnership: 'shared-host'; readonly externalEffectsEnabled: false }

export async function runSshSubsystemEntryV1(argv: readonly string[], environment: NodeJS.ProcessEnv, input: AsyncIterable<Buffer | string>, write: (value: Buffer) => void | Promise<void>): Promise<void> {
  if (environment.QUARK_SSH_SUBSYSTEM_ENABLE !== '1' || argv.length !== 2 || argv[0] !== 'quark-device-v1') throw new Error('SSH subsystem entry is disabled')
  const config = await loadConfig(argv[1]!); const chunks: Buffer[] = []; let size = 0
  for await (const chunk of input) { const bytes = Buffer.from(chunk); size += bytes.byteLength; if (size > MAX_DEVICE_FRAME_BYTES + 4) throw new Error('SSH subsystem request is too large'); chunks.push(bytes) }
  if (!size) throw new Error('SSH subsystem request is missing')
  await write(await proxySshSubsystemFrameV1(config.socketPath, Buffer.concat(chunks), config.timeoutMs))
}

async function loadConfig(path: string): Promise<SshSubsystemEntryConfigV1> {
  if (!isAbsolute(path) || resolve(path) !== path || /[\r\n\0]/.test(path)) throw new Error('SSH subsystem config path is invalid')
  const state = await lstat(path); const uid = process.getuid?.()
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('SSH subsystem config file is unsafe')
  const root = dirname(path); const parent = await lstat(root)
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || await realpath(root) !== root || (uid !== undefined && parent.uid !== uid)) throw new Error('SSH subsystem config root is unsafe')
  const raw = await readFile(path); if (raw.byteLength > 4096) throw new Error('SSH subsystem config is too large')
  let value: unknown; try { value = JSON.parse(raw.toString('utf8')) } finally { raw.fill(0) }
  if (!isRecord(value)) throw new Error('SSH subsystem config is invalid'); const keys = ['schemaVersion', 'socketPath', 'timeoutMs', 'providerOwnership', 'externalEffectsEnabled']
  try { exactPortableUnixSocketPathV1(value.socketPath) } catch { throw new Error('SSH subsystem config is invalid') }
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || !Number.isSafeInteger(value.timeoutMs) || (value.timeoutMs as number) < 1_000 || (value.timeoutMs as number) > 30_000 || value.providerOwnership !== 'shared-host' || value.externalEffectsEnabled !== false) throw new Error('SSH subsystem config is invalid')
  return value as unknown as SshSubsystemEntryConfigV1
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

async function main(): Promise<void> { try { await runSshSubsystemEntryV1(process.argv.slice(2), process.env, process.stdin, value => new Promise((accept, reject) => process.stdout.write(value, error => error ? reject(error) : accept()))); process.exitCode = 0 } catch { process.stderr.write('ssh-subsystem-failed\n'); process.exitCode = 1 } }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main()
