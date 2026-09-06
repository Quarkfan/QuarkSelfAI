import assert from 'node:assert/strict'
import { chmod, lstat, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { proxySshSubsystemFrameV1 } from '../src/client-runtime/ssh-subsystem-ipc-proxy.js'
import { openCloudSshIpcBridgeV1, reconcileStaleCloudSshIpcSocketV1 } from '../src/control-plane/cloud-ssh-ipc.js'

test('proxies one SSH subsystem frame to the existing cloud host over an owner-only Unix socket', async t => {
  const created = await mkdtemp(join(tmpdir(), 'quark-ssh-ipc-')); await chmod(created, 0o700); const root = await realpath(created); const socketPath = join(root, 'device.sock')
  let calls = 0; const host = { async handleSshFrame(frame: Buffer) { calls += 1; return Buffer.concat([Buffer.from('response:'), frame]) } }
  let bridge: Awaited<ReturnType<typeof openCloudSshIpcBridgeV1>> | undefined
  try {
    try { bridge = await openCloudSshIpcBridgeV1({ schemaVersion: 1, enabled: true, socketPath, requestTimeoutMs: 2_000, providerOwnership: 'shared-host', externalEffectsEnabled: false }, host) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit Unix socket listeners'); return }; throw error }
    try {
      assert.equal((await lstat(socketPath)).mode & 0o077, 0)
      await assert.rejects(reconcileStaleCloudSshIpcSocketV1(socketPath), /still active/)
      assert.equal((await lstat(socketPath)).isSocket(), true)
      assert.equal((await proxySshSubsystemFrameV1(socketPath, Buffer.from('frame'))).toString(), 'response:frame')
      assert.deepEqual({ calls, requests: bridge.requestCount(), mode: bridge.mode }, { calls: 1, requests: 2, mode: 'owner-only' })
    } finally { await bridge.close(); bridge = undefined }
    await assert.rejects(lstat(socketPath), error => (error as NodeJS.ErrnoException).code === 'ENOENT')
  } finally { if (bridge) await bridge.close(); await rm(root, { recursive: true, force: true }) }
})

test('rejects public roots, existing socket paths and independent provider ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-ssh-ipc-')); const socketPath = join(root, 'device.sock'); const host = { async handleSshFrame(frame: Buffer) { return frame } }
  try {
    await chmod(root, 0o755)
    await assert.rejects(() => openCloudSshIpcBridgeV1({ schemaVersion: 1, enabled: true, socketPath, requestTimeoutMs: 2_000, providerOwnership: 'shared-host', externalEffectsEnabled: false }, host), /root is unsafe/)
    await chmod(root, 0o700)
    await assert.rejects(() => openCloudSshIpcBridgeV1({ schemaVersion: 1, enabled: true, socketPath, requestTimeoutMs: 2_000, providerOwnership: 'independent', externalEffectsEnabled: false }, host), /config is invalid/)
    assert.throws(() => proxySshSubsystemFrameV1(socketPath, Buffer.alloc(0)), /input is invalid/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
