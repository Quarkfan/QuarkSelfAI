import assert from 'node:assert/strict'
import test from 'node:test'
import { MacOsKeychainMasterKeyProviderV1, type KeychainReadObservationV1, type MacOsKeychainReadRunnerV1 } from '../src/client-runtime/macos-keychain-master-key.js'

class Runner implements MacOsKeychainReadRunnerV1 {
  constructor(private readonly observation: KeychainReadObservationV1) {}
  async read(account: string): Promise<KeychainReadObservationV1> { assert.equal(account, 'device.owner'); return this.observation }
}

test('loads and clears one exact 32-byte base64url key from a fixed macOS keychain account', async () => {
  const bytes = Uint8Array.from(Buffer.from(Buffer.from(new Uint8Array(32).fill(9)).toString('base64url'), 'utf8'))
  const key = await new MacOsKeychainMasterKeyProviderV1('device.owner', new Runner({ state: 'completed', output: bytes }), 'darwin').load()
  assert.deepEqual(key, new Uint8Array(32).fill(9)); assert.ok(bytes.every(value => value === 0))
})

test('fails closed without leaking keychain output or accepting another platform', async () => {
  const malformed = Uint8Array.from(Buffer.from('sensitive malformed output'))
  await assert.rejects(() => new MacOsKeychainMasterKeyProviderV1('device.owner', new Runner({ state: 'completed', output: malformed }), 'darwin').load(), error => {
    assert.equal(String(error).includes('sensitive'), false); return true
  })
  assert.ok(malformed.every(value => value === 0))
  await assert.rejects(() => new MacOsKeychainMasterKeyProviderV1('device.owner', new Runner({ state: 'not-found', output: new Uint8Array() }), 'linux').load(), /unavailable on this platform/)
  assert.throws(() => new MacOsKeychainMasterKeyProviderV1('../unsafe', new Runner({ state: 'not-found', output: new Uint8Array() }), 'darwin'), /account is invalid/)
})
