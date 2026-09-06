import { spawn } from 'node:child_process'
import type { LocalMasterKeyProviderV1 } from './contracts.js'

const service = 'com.quarkselfai.client.master-key.v1'
const accountPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const encodedKeyPattern = /^[A-Za-z0-9_-]{43}$/
const maxOutputBytes = 128

export interface KeychainReadObservationV1 {
  readonly state: 'completed' | 'not-found' | 'failed' | 'timed-out'
  readonly output: Uint8Array
}

export interface MacOsKeychainReadRunnerV1 { read(account: string): Promise<KeychainReadObservationV1> }

/** Reads one fixed generic-password item. It never accepts or writes a secret through process arguments. */
export class NodeMacOsKeychainReadRunnerV1 implements MacOsKeychainReadRunnerV1 {
  read(account: string): Promise<KeychainReadObservationV1> {
    if (!accountPattern.test(account)) throw new Error('keychain account is invalid')
    return new Promise(resolve => {
      let output = Buffer.alloc(0); let overflow = false; let settled = false
      const child = spawn('security', ['find-generic-password', '-w', '-s', service, '-a', account], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })
      child.stdout.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.from(chunk)
        if (output.byteLength + bytes.byteLength > maxOutputBytes) { overflow = true; return }
        output = Buffer.concat([output, bytes])
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
