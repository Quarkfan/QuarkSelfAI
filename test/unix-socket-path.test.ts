import assert from 'node:assert/strict'
import test from 'node:test'
import { exactPortableUnixSocketPathV1, MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES } from '../src/client-runtime/unix-socket-path.js'

test('accepts an exact Unix socket path within the conservative portable byte bound', () => {
  const path = `/${'a'.repeat(MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES - 1)}`
  assert.equal(Buffer.byteLength(path), MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES)
  assert.equal(exactPortableUnixSocketPathV1(path), path)
})

test('rejects overlong UTF-8, relative and traversal-shaped Unix socket paths', () => {
  assert.throws(() => exactPortableUnixSocketPathV1(`/${'a'.repeat(MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES)}`), /not portable/)
  assert.throws(() => exactPortableUnixSocketPathV1(`/tmp/${'界'.repeat(33)}`), /not portable/)
  assert.throws(() => exactPortableUnixSocketPathV1('runtime/device.sock'), /not portable/)
  assert.throws(() => exactPortableUnixSocketPathV1('/tmp/../device.sock'), /not portable/)
})
