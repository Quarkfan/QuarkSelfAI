import assert from 'node:assert/strict'
import test from 'node:test'
import { MacOsKeychainMasterKeyLifecycleV1, MacOsKeychainMasterKeyProviderV1, type KeychainReadObservationV1, type MacOsKeychainProvisionRunnerV1, type MacOsKeychainReadRunnerV1 } from '../src/client-runtime/macos-keychain-master-key.js'

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

test('keeps an existing key without invoking the provisioning writer', async () => {
  const encoded = Uint8Array.from(Buffer.from(Buffer.from(new Uint8Array(32).fill(4)).toString('base64url'))); let writes = 0
  const writer: MacOsKeychainProvisionRunnerV1 = { async add() { writes += 1; return 'completed' } }
  assert.equal(await new MacOsKeychainMasterKeyLifecycleV1('device.owner', new Runner({ state: 'completed', output: encoded }), writer, 'darwin').ensure(), 'existing')
  assert.equal(writes, 0); assert.ok(encoded.every(value => value === 0))
})

test('creates a random key through stdin boundary and verifies the exact stored value', async () => {
  const observations: KeychainReadObservationV1[] = [{ state: 'not-found', output: new Uint8Array() }]
  const reader: MacOsKeychainReadRunnerV1 = { async read() { return observations.shift() ?? { state: 'failed', output: new Uint8Array() } } }
  let writerBytes: Uint8Array | undefined
  const writer: MacOsKeychainProvisionRunnerV1 = { async add(account, encodedKey) { assert.equal(account, 'device.owner'); writerBytes = Uint8Array.from(encodedKey); observations.push({ state: 'completed', output: Uint8Array.from(encodedKey) }); return 'completed' } }
  assert.equal(await new MacOsKeychainMasterKeyLifecycleV1('device.owner', reader, writer, 'darwin').ensure(), 'created')
  assert.equal(writerBytes?.byteLength, 43); assert.match(Buffer.from(writerBytes ?? []).toString(), /^[A-Za-z0-9_-]{43}$/)
})

test('accepts a concurrent creator only after a valid Keychain readback', async () => {
  const key = Buffer.from(new Uint8Array(32).fill(8)).toString('base64url')
  const observations: KeychainReadObservationV1[] = [{ state: 'not-found', output: new Uint8Array() }, { state: 'completed', output: Uint8Array.from(Buffer.from(key)) }]
  const reader: MacOsKeychainReadRunnerV1 = { async read() { return observations.shift() ?? { state: 'failed', output: new Uint8Array() } } }
  const writer: MacOsKeychainProvisionRunnerV1 = { async add() { return 'failed' } }
  assert.equal(await new MacOsKeychainMasterKeyLifecycleV1('device.owner', reader, writer, 'darwin').ensure(), 'existing')
  await assert.rejects(new MacOsKeychainMasterKeyLifecycleV1('device.owner', { async read() { return { state: 'failed', output: Uint8Array.from(Buffer.from('private')) } } }, writer, 'darwin').ensure(), error => { assert.doesNotMatch(String(error), /private/); return true })
})
