import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EncryptedFileDeviceSecretStoreV1 } from '../src/client-runtime/encrypted-file-secret-store.js'

test('persists authenticated encrypted device secrets without storing reference or plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-secret-store-')); const root = join(directory, 'secrets'); const key = new Uint8Array(32).fill(7); const value = Buffer.from('private-fixture-material')
  try {
    let store = await EncryptedFileDeviceSecretStoreV1.open(root, key); await store.put('secret:device.owner', value)
    assert.deepEqual(Buffer.from((await store.get('secret:device.owner'))!), value)
    await assert.rejects(() => store.put('secret:device.owner', value), /already exists/)
    const files = await readdir(root); assert.equal(files.length, 1); const encoded = await readFile(join(root, files[0]!), 'utf8')
    assert.equal(encoded.includes('private-fixture-material'), false); assert.equal(encoded.includes('secret:device.owner'), false)
    store.close(); await assert.rejects(() => store.get('secret:device.owner'), /closed/)
    store = await EncryptedFileDeviceSecretStoreV1.open(root, key); assert.deepEqual(Buffer.from((await store.get('secret:device.owner'))!), value); store.close()
    const wrong = await EncryptedFileDeviceSecretStoreV1.open(root, new Uint8Array(32).fill(8)); await assert.rejects(() => wrong.get('secret:device.owner'), /authentication failed/); wrong.close()
    const cleanup = await EncryptedFileDeviceSecretStoreV1.open(root, key); assert.equal(await cleanup.remove('secret:device.owner'), true); assert.equal(await cleanup.get('secret:device.owner'), undefined); cleanup.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rejects path-like references, unsafe record links and invalid master keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-secret-store-')); const root = join(directory, 'secrets'); const outside = join(directory, 'outside.json'); const linkedRoot = join(directory, 'linked-secrets')
  try {
    await assert.rejects(() => EncryptedFileDeviceSecretStoreV1.open(root, new Uint8Array(31)), /32-byte/)
    await mkdir(root); await symlink(root, linkedRoot); await assert.rejects(() => EncryptedFileDeviceSecretStoreV1.open(linkedRoot, new Uint8Array(32)), /symbolic link/)
    const store = await EncryptedFileDeviceSecretStoreV1.open(root, new Uint8Array(32).fill(1)); await assert.rejects(() => store.put('secret:../escape', Uint8Array.of(1)), /reference is invalid/)
    await store.put('secret:device.owner', Uint8Array.of(1, 2, 3)); const [file] = await readdir(root); await rm(join(root, file!)); await writeFile(outside, '{}'); await symlink(outside, join(root, file!))
    await assert.rejects(() => store.get('secret:device.owner'), /unsafe/); store.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
