import assert from 'node:assert/strict'
import test from 'node:test'
import { MacOsKeychainOwnerCredentialV1, type OwnerCredentialReadObservationV1 } from '../src/control-plane/macos-keychain-owner-credential.js'

test('creates, verifies and reloads one opaque server owner credential', async () => {
  const observations: OwnerCredentialReadObservationV1[] = [{ state: 'not-found', output: new Uint8Array() }]; let stored = new Uint8Array()
  const reader = { async read() { return observations.shift() ?? { state: 'completed' as const, output: Uint8Array.from(stored) } } }
  const writer = { async add(_account: string, value: Uint8Array) { stored = Uint8Array.from(value); observations.push({ state: 'completed', output: Uint8Array.from(value) }); return 'completed' as const } }
  const lifecycle = new MacOsKeychainOwnerCredentialV1('personal.owner', reader, writer, 'darwin')
  assert.equal(await lifecycle.ensure(), 'created'); assert.equal(stored.byteLength, 43)
  const loaded = await lifecycle.load(); try { assert.equal(loaded.byteLength, 43); assert.equal(loaded.toString(), Buffer.from(stored).toString()) } finally { loaded.fill(0); stored.fill(0) }
})

test('fails closed on unavailable, malformed and unsupported keychains', async () => {
  const writer = { async add() { return 'failed' as const } }
  await assert.rejects(() => new MacOsKeychainOwnerCredentialV1('personal.owner', { async read() { return { state: 'failed' as const, output: new Uint8Array() } } }, writer, 'darwin').ensure(), /unavailable/)
  await assert.rejects(() => new MacOsKeychainOwnerCredentialV1('personal.owner', { async read() { return { state: 'completed' as const, output: Buffer.from('invalid') } } }, writer, 'darwin').load(), /invalid/)
  await assert.rejects(() => new MacOsKeychainOwnerCredentialV1('personal.owner', { async read() { return { state: 'not-found' as const, output: new Uint8Array() } } }, writer, 'linux').ensure(), /platform/)
})
