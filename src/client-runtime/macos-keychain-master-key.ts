import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { LocalMasterKeyProviderV1, LocalMasterKeyProvisionerV1 } from './contracts.js'

const service = 'com.quarkselfai.client.master-key.v1'
const accountPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const encodedKeyPattern = /^[A-Za-z0-9_-]{43}$/
const maxOutputBytes = 128

export interface KeychainReadObservationV1 {
  readonly state: 'completed' | 'not-found' | 'failed' | 'timed-out'
  readonly output: Uint8Array
}

export interface MacOsKeychainReadRunnerV1 { read(account: string): Promise<KeychainReadObservationV1> }
export interface MacOsKeychainProvisionRunnerV1 { add(account: string, encodedKey: Uint8Array): Promise<'completed' | 'failed' | 'timed-out'> }

/** Reads one fixed generic-password item. It never accepts or writes a secret through process arguments. */
export class NodeMacOsKeychainReadRunnerV1 implements MacOsKeychainReadRunnerV1 {
  read(account: string): Promise<KeychainReadObservationV1> {
    if (!accountPattern.test(account)) throw new Error('keychain account is invalid')
    return new Promise(resolve => {
      let output = Buffer.alloc(0); let overflow = false; let settled = false
      const child = spawn('/usr/bin/security', ['find-generic-password', '-w', '-s', service, '-a', account], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })
      child.stdout.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.from(chunk)
        try {
          if (output.byteLength + bytes.byteLength > maxOutputBytes) { overflow = true; return }
          const previous = output; output = Buffer.concat([previous, bytes]); previous.fill(0)
        } finally { bytes.fill(0) }
      })
      const finish = (state: KeychainReadObservationV1['state']) => {
        if (settled) return
        settled = true; clearTimeout(timer)
        const exposed = state === 'completed' && !overflow ? Uint8Array.from(output) : new Uint8Array()
        output.fill(0); resolve({ state: overflow ? 'failed' : state, output: exposed })
      }
      child.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'failed'))
      child.once('close', code => finish(code === 0 ? 'completed' : code === 44 ? 'not-found' : 'failed'))
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish('timed-out') }, 5_000); timer.unref()
    })
  }
}

/** Adds one generated key through stdin. The credential is never present in argv, stdout or an error. */
export class NodeMacOsKeychainProvisionRunnerV1 implements MacOsKeychainProvisionRunnerV1 {
  add(account: string, encodedKey: Uint8Array): Promise<'completed' | 'failed' | 'timed-out'> {
    if (!accountPattern.test(account) || !base64UrlBytes(encodedKey)) throw new Error('keychain provisioning input is invalid')
    return new Promise(resolve => {
      let settled = false
      const input = Buffer.alloc(encodedKey.byteLength + 1); input.set(encodedKey); input[input.byteLength - 1] = 0x0a
      const child = spawn('/usr/bin/security', ['add-generic-password', '-a', account, '-s', service, '-w'], { shell: false, stdio: ['pipe', 'ignore', 'ignore'] })
      const finish = (state: 'completed' | 'failed' | 'timed-out') => { if (settled) return; settled = true; clearTimeout(timer); input.fill(0); resolve(state) }
      child.once('error', () => finish('failed'))
      child.stdin.once('error', () => finish('failed'))
      child.once('close', code => finish(code === 0 ? 'completed' : 'failed'))
      child.stdin.end(input, () => input.fill(0))
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish('timed-out') }, 5_000); timer.unref()
    })
  }
}

/** Loads a pre-provisioned 32-byte key from macOS Keychain and returns no account or secret in errors. */
export class MacOsKeychainMasterKeyProviderV1 implements LocalMasterKeyProviderV1 {
  constructor(private readonly account: string, private readonly runner: MacOsKeychainReadRunnerV1 = new NodeMacOsKeychainReadRunnerV1(), private readonly platform = process.platform) {
    if (!accountPattern.test(account)) throw new Error('keychain account is invalid')
  }

  async load(): Promise<Uint8Array> {
    if (this.platform !== 'darwin') throw new Error('macOS keychain master key is unavailable on this platform')
    const observation = await this.runner.read(this.account)
    try {
      if (observation.state !== 'completed') throw new Error('macOS keychain master key is unavailable')
      const encoded = Buffer.from(observation.output).toString('utf8').trim()
      if (!encodedKeyPattern.test(encoded)) throw new Error('macOS keychain master key is invalid')
      const key = Buffer.from(encoded, 'base64url')
      if (key.byteLength !== 32) { key.fill(0); throw new Error('macOS keychain master key is invalid') }
      const result = Uint8Array.from(key); key.fill(0); return result
    } finally { observation.output.fill(0) }
  }
}

/** Idempotently provisions the fixed client master key, then proves Keychain retained the same value. */
export class MacOsKeychainMasterKeyLifecycleV1 implements LocalMasterKeyProvisionerV1 {
  constructor(private readonly account: string, private readonly reader: MacOsKeychainReadRunnerV1 = new NodeMacOsKeychainReadRunnerV1(), private readonly writer: MacOsKeychainProvisionRunnerV1 = new NodeMacOsKeychainProvisionRunnerV1(), private readonly platform = process.platform) {
    if (!accountPattern.test(account)) throw new Error('keychain account is invalid')
  }

  async ensure(): Promise<'created' | 'existing'> {
    if (this.platform !== 'darwin') throw new Error('macOS keychain provisioning is unavailable on this platform')
    const initial = await this.reader.read(this.account)
    if (initial.state === 'completed') { const existing = decodeKey(initial.output); existing.fill(0); return 'existing' }
    initial.output.fill(0)
    if (initial.state !== 'not-found') throw new Error('macOS keychain provisioning is unavailable')
    const generated = randomBytes(32); const encoded = Buffer.from(generated.toString('base64url'), 'utf8')
    try {
      const written = await this.writer.add(this.account, encoded)
      const verified = await this.reader.read(this.account)
      if (verified.state !== 'completed') { verified.output.fill(0); throw new Error('macOS keychain provisioning could not be verified') }
      const recovered = decodeKey(verified.output)
      try {
        if (written === 'completed' && !timingSafeEqual(generated, recovered)) throw new Error('macOS keychain provisioning identity drifted')
        if (written !== 'completed') return 'existing'
        return 'created'
      } finally { recovered.fill(0) }
    } finally { generated.fill(0); encoded.fill(0) }
  }
}

function decodeKey(output: Uint8Array): Buffer {
  try {
    const encoded = Buffer.from(output).toString('utf8').trim()
    if (!encodedKeyPattern.test(encoded)) throw new Error('macOS keychain master key is invalid')
    const key = Buffer.from(encoded, 'base64url')
    if (key.byteLength !== 32) { key.fill(0); throw new Error('macOS keychain master key is invalid') }
    return key
  } finally { output.fill(0) }
}

function base64UrlBytes(value: Uint8Array): boolean {
  return value.byteLength === 43 && value.every(byte => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte === 0x5f || byte === 0x2d)
}
