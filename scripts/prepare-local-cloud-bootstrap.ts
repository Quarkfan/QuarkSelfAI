import { generateKeyPairSync } from 'node:crypto'
import { chmod, lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { MacOsKeychainOwnerCredentialV1 } from '../src/control-plane/macos-keychain-owner-credential.js'

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) { const name = process.argv[index]; const value = process.argv[index + 1]; if (name?.startsWith('--') && value) args.set(name.slice(2), value) }
const bootstrapRoot = exactPath(args.get('bootstrap-root')); const installRoot = exactPath(args.get('install-root')); const tlsKey = exactPath(args.get('tls-key')); const tlsCert = exactPath(args.get('tls-cert'))
if (args.size !== 4) throw new Error('required exact arguments: --bootstrap-root --install-root --tls-key --tls-cert')

await privateFile(tlsKey); await privateFile(tlsCert); await mkdir(bootstrapRoot, { recursive: true, mode: 0o700 }); await chmod(bootstrapRoot, 0o700)
if (await realpath(bootstrapRoot) !== bootstrapRoot) throw new Error('bootstrap root must be canonical')
const pair = generateKeyPairSync('ed25519'); const privateBytes = Buffer.from(pair.privateKey.export({ format: 'pem', type: 'pkcs8' })); const publicKey = `ed25519-spki:${(pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
const signingKeyPath = join(bootstrapRoot, 'plan-signing-key.pem')
try {
  await atomic(signingKeyPath, privateBytes)
  const credentialState = await new MacOsKeychainOwnerCredentialV1('personal.owner').ensure()
  await atomicJson(join(bootstrapRoot, 'server-config.json'), { tlsKeySourcePath: tlsKey, tlsCertSourcePath: tlsCert, planSigningKeySourcePath: signingKeyPath, host: '127.0.0.1', port: 9443, requestTimeoutMs: 5_000, maxConnections: 100, sshRequestTimeoutMs: 5_000, planVerification: { keyId: 'control.primary', publicKey } })
  await atomicJson(join(bootstrapRoot, 'owner-config.json'), { tenantId: 'personal', tenantName: 'Personal', userId: 'owner', displayName: 'Owner' })
  await atomicJson(join(bootstrapRoot, 'service-config.json'), { platform: 'launchd-user', nodeExecutable: process.execPath, stdoutPath: join(bootstrapRoot, 'server.out'), stderrPath: join(bootstrapRoot, 'server.err') })
  const home = process.env.HOME; if (!home || !isAbsolute(home)) throw new Error('owner home is unavailable')
  await atomicJson(join(bootstrapRoot, 'activation-config.json'), { definitionTargetPath: join(home, 'Library/LaunchAgents/com.quarkfan.quark-server.plist') })
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, state: 'prepared-inactive', keyId: 'control.primary', publicKey, credentialState, externalEffectsEnabled: false })}\n`)
} finally { privateBytes.fill(0) }

async function atomicJson(path: string, value: unknown): Promise<void> { const bytes = Buffer.from(`${JSON.stringify(value)}\n`); try { await atomic(path, bytes) } finally { bytes.fill(0) } }
async function atomic(path: string, value: Buffer): Promise<void> { const temporary = `${path}.next`; await writeFile(temporary, value, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, path) }
async function privateFile(path: string): Promise<void> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('bootstrap input is unsafe') }
function exactPath(value: string | undefined): string { if (!value || !isAbsolute(value) || resolve(value) !== value || value === '/' || /[\r\n\0]/.test(value)) throw new Error('bootstrap path must be exact and absolute'); return value }
