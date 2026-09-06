import { randomBytes } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NodeEd25519DeviceProofVerifierV1 } from '../client-runtime/device-identity.js'
import { NodePinnedEd25519PlanVerifierV1 } from '../client-runtime/plan-signature.js'
import { openPreparedCloudServerRuntimeV1 } from './cloud-server-runtime.js'

interface CloudServerEntryConfigV1 { readonly schemaVersion: 1; readonly runtime: unknown; readonly tlsCredentials: { readonly keyPath: string; readonly certPath: string }; readonly planVerification: { readonly keyId: string; readonly publicKey: string } }

export async function runCloudServerEntryV1(argv = process.argv.slice(2), environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (environment.QUARK_CLOUD_SERVER_ENABLE !== '1' || argv.length !== 2 || argv[0] !== 'run') throw new Error('cloud server entry is disabled')
  const config = await loadConfig(argv[1]!); const key = await readPrivate(config.tlsCredentials.keyPath, config.root, 32_768); let cert: Buffer | undefined
  let runtime: Awaited<ReturnType<typeof openPreparedCloudServerRuntimeV1>>
  try { cert = await readPrivate(config.tlsCredentials.certPath, config.root, 65_536); runtime = await openPreparedCloudServerRuntimeV1(config.runtime, { key, cert }, { tokens: { next: label => `${label}.${randomBytes(24).toString('hex')}` }, proofVerifier: new NodeEd25519DeviceProofVerifierV1(), planVerifier: new NodePinnedEd25519PlanVerifierV1(config.planVerification.keyId, config.planVerification.publicKey) }) }
  finally { key.fill(0); cert?.fill(0) }
  await new Promise<void>((resolveRun, rejectRun) => {
    let stopping = false
    const stop = (): void => { if (stopping) return; stopping = true; process.off('SIGTERM', stop); process.off('SIGINT', stop); void runtime.close().then(resolveRun, rejectRun) }
    process.once('SIGTERM', stop); process.once('SIGINT', stop)
    process.stdout.write('{"schemaVersion":1,"state":"ready","transport":"tls+ssh","externalEffectsEnabled":false}\n')
  })
}

async function loadConfig(path: string): Promise<CloudServerEntryConfigV1 & { readonly root: string }> {
  if (!isAbsolute(path) || resolve(path) !== path || /[\r\n\0]/.test(path)) throw new Error('cloud server entry config is invalid')
  const root = dirname(path); await assertPrivateRoot(root); const bytes = await readPrivate(path, root, 64 * 1024)
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown
    if (!isRecord(value)) throw new Error('cloud server entry config is invalid')
    const keys = ['schemaVersion', 'runtime', 'tlsCredentials', 'planVerification']
    if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || !isRecord(value.runtime) || !isRecord(value.tlsCredentials) || !isRecord(value.planVerification) || Object.keys(value.tlsCredentials).sort().join(',') !== 'certPath,keyPath' || Object.keys(value.planVerification).sort().join(',') !== 'keyId,publicKey' || typeof value.tlsCredentials.keyPath !== 'string' || typeof value.tlsCredentials.certPath !== 'string' || typeof value.planVerification.keyId !== 'string' || typeof value.planVerification.publicKey !== 'string') throw new Error('cloud server entry config is invalid')
    return { ...(value as unknown as CloudServerEntryConfigV1), root }
  } finally { bytes.fill(0) }
}
async function assertPrivateRoot(root: string): Promise<void> { const state = await lstat(root); const uid = process.getuid?.(); if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(root) !== root || (uid !== undefined && state.uid !== uid)) throw new Error('cloud server entry root is unsafe') }
async function readPrivate(path: string, root: string, maxBytes: number): Promise<Buffer> {
  if (!isAbsolute(path) || resolve(path) !== path || relative(root, path).startsWith('..') || isAbsolute(relative(root, path)) || /[\r\n\0]/.test(path)) throw new Error('cloud server entry file is invalid')
  const state = await lstat(path); const uid = process.getuid?.()
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || state.size < 1 || state.size > maxBytes || (state.mode & 0o077) !== 0 || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('cloud server entry file is unsafe')
  return await readFile(path)
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCloudServerEntryV1().catch(() => { process.stderr.write('Cloud server failed: startup-or-runtime-failure\n'); process.exitCode = 1 })
}
