import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const service = 'com.quarkselfai.server.owner-credential.v1'
const accountPattern = /^[a-z0-9][a-z0-9.-]{1,127}$/
const encodedPattern = /^[A-Za-z0-9_-]{43}$/

export interface OwnerCredentialReadObservationV1 { readonly state: 'completed' | 'not-found' | 'failed' | 'timed-out'; readonly output: Uint8Array }
export interface OwnerCredentialReadRunnerV1 { read(account: string): Promise<OwnerCredentialReadObservationV1> }
export interface OwnerCredentialWriteRunnerV1 { add(account: string, credential: Uint8Array): Promise<'completed' | 'failed' | 'timed-out'> }

export class NodeOwnerCredentialReadRunnerV1 implements OwnerCredentialReadRunnerV1 {
  read(account: string): Promise<OwnerCredentialReadObservationV1> {
    validAccount(account)
    return new Promise(resolve => {
      let output = Buffer.alloc(0); let overflow = false; let settled = false
      const child = spawn('/usr/bin/swift', ['-module-cache-path', join(tmpdir(), 'quarkselfai-swift-module-cache'), '-e', swiftKeychainReader, service, account], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })
      child.stdout.on('data', chunk => { const bytes = Buffer.from(chunk); try { if (output.byteLength + bytes.byteLength > 128) { overflow = true; return }; const prior = output; output = Buffer.concat([prior, bytes]); prior.fill(0) } finally { bytes.fill(0) } })
      const finish = (state: OwnerCredentialReadObservationV1['state']) => { if (settled) return; settled = true; clearTimeout(timer); const bounded = state === 'completed' && !overflow ? Uint8Array.from(output) : new Uint8Array(); output.fill(0); resolve({ state: overflow ? 'failed' : state, output: bounded }) }
      child.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'failed'))
      child.once('close', code => finish(code === 0 ? 'completed' : code === 44 ? 'not-found' : 'failed'))
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish('timed-out') }, 60_000); timer.unref()
    })
  }
}

export class NodeOwnerCredentialWriteRunnerV1 implements OwnerCredentialWriteRunnerV1 {
  add(account: string, credential: Uint8Array): Promise<'completed' | 'failed' | 'timed-out'> {
    validAccount(account); validateEncoded(credential)
    return new Promise(resolve => {
      let settled = false; const input = Buffer.alloc(credential.byteLength + 1); input.set(credential); input[input.byteLength - 1] = 0x0a
      const child = spawn('/usr/bin/swift', ['-module-cache-path', join(tmpdir(), 'quarkselfai-swift-module-cache'), '-e', swiftKeychainWriter, service, account], { shell: false, stdio: ['pipe', 'ignore', 'ignore'] })
      const finish = (state: 'completed' | 'failed' | 'timed-out') => { if (settled) return; settled = true; clearTimeout(timer); input.fill(0); resolve(state) }
      child.once('error', () => finish('failed')); child.stdin.once('error', () => finish('failed')); child.once('close', code => finish(code === 0 ? 'completed' : 'failed')); child.stdin.end(input, () => input.fill(0))
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish('timed-out') }, 60_000); timer.unref()
    })
  }
}

/** Owns exactly one random server owner password in macOS Keychain; values never enter argv or receipts. */
export class MacOsKeychainOwnerCredentialV1 {
  constructor(private readonly account: string, private readonly reader: OwnerCredentialReadRunnerV1 = new NodeOwnerCredentialReadRunnerV1(), private readonly writer: OwnerCredentialWriteRunnerV1 = new NodeOwnerCredentialWriteRunnerV1(), private readonly platform = process.platform) { validAccount(account) }

  async ensure(): Promise<'created' | 'existing'> {
    this.#darwin(); const initial = await this.reader.read(this.account)
    if (initial.state === 'completed') { decode(initial.output).fill(0); return 'existing' }
    initial.output.fill(0); if (initial.state !== 'not-found') throw new Error('server owner credential keychain is unavailable')
    const raw = randomBytes(32); const encoded = Buffer.from(raw.toString('base64url'))
    try {
      const written = await this.writer.add(this.account, encoded); const observed = await this.reader.read(this.account)
      if (observed.state !== 'completed') { observed.output.fill(0); throw new Error('server owner credential could not be verified') }
      const recovered = decode(observed.output)
      try { if (!timingSafeEqual(encoded, recovered)) throw new Error('server owner credential identity drifted'); if (written !== 'completed') return 'existing'; return 'created' }
      finally { recovered.fill(0) }
    } finally { raw.fill(0); encoded.fill(0) }
  }

  async load(): Promise<Buffer> { this.#darwin(); const observed = await this.reader.read(this.account); if (observed.state !== 'completed') { observed.output.fill(0); throw new Error('server owner credential is unavailable') }; return decode(observed.output) }
  #darwin(): void { if (this.platform !== 'darwin') throw new Error('server owner credential keychain is unavailable on this platform') }
}

function decode(output: Uint8Array): Buffer { try { const value = Buffer.from(output).toString('utf8').trim(); if (!encodedPattern.test(value)) throw new Error('server owner credential is invalid'); return Buffer.from(value) } finally { output.fill(0) } }
function validateEncoded(value: Uint8Array): void { if (value.byteLength !== 43 || !encodedPattern.test(Buffer.from(value).toString('utf8'))) throw new Error('server owner credential input is invalid') }
function validAccount(account: string): void { if (!accountPattern.test(account)) throw new Error('server owner credential account is invalid') }

const swiftKeychainWriter = `import Foundation
import Security
var value = FileHandle.standardInput.readDataToEndOfFile()
if value.last == 10 { value.removeLast() }
let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: CommandLine.arguments[1], kSecAttrAccount: CommandLine.arguments[2], kSecValueData: value, kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock]
let status = SecItemAdd(query as CFDictionary, nil)
exit(status == errSecSuccess ? 0 : 1)
`

const swiftKeychainReader = `import Foundation
import Security
let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: CommandLine.arguments[1], kSecAttrAccount: CommandLine.arguments[2], kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
var item: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &item)
if status == errSecItemNotFound { exit(44) }
guard status == errSecSuccess, let value = item as? Data else { exit(1) }
FileHandle.standardOutput.write(value)
`
