import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { openCloudSshIpcBridgeV1 } from '../src/control-plane/cloud-ssh-ipc.js'

test('runs the built sshd subsystem entry as an IPC-only process', async t => {
  const created = await mkdtemp(join(tmpdir(), 'quark-ssh-entry-')); await chmod(created, 0o700); const root = await realpath(created); const socketPath = join(root, 'device.sock'); const configPath = join(root, 'subsystem.json')
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, socketPath, timeoutMs: 2_000, providerOwnership: 'shared-host', externalEffectsEnabled: false }), { mode: 0o600 })
  let bridge: Awaited<ReturnType<typeof openCloudSshIpcBridgeV1>> | undefined
  try {
    try { bridge = await openCloudSshIpcBridgeV1({ schemaVersion: 1, enabled: true, socketPath, requestTimeoutMs: 2_000, providerOwnership: 'shared-host', externalEffectsEnabled: false }, { async handleSshFrame(frame) { return Buffer.concat([Buffer.from('ack:'), frame]) } }) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('sandbox does not permit Unix socket listeners'); return }; throw error }
    const result = await child(['quark-device-v1', configPath], { ...process.env, QUARK_SSH_SUBSYSTEM_ENABLE: '1' }, Buffer.from('frame'))
    assert.deepEqual({ code: result.code, stdout: result.stdout.toString(), stderr: result.stderr }, { code: 0, stdout: 'ack:frame', stderr: '' })
    const disabled = await child(['quark-device-v1', configPath], { ...process.env, QUARK_SSH_SUBSYSTEM_ENABLE: '0' }, Buffer.from('frame'))
    assert.deepEqual({ code: disabled.code, stdout: disabled.stdout.length, stderr: disabled.stderr }, { code: 1, stdout: 0, stderr: 'ssh-subsystem-failed\n' })
    assert.equal(disabled.stderr.includes(root), false)
  } finally { if (bridge) await bridge.close(); await rm(root, { recursive: true, force: true }) }
})

function child(args: string[], env: NodeJS.ProcessEnv, input: Buffer): Promise<{ code: number | null; stdout: Buffer; stderr: string }> { return new Promise((accept, reject) => { const childProcess = spawn(process.execPath, [resolve('dist/client-runtime/ssh-subsystem-entry.js'), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }); const stdout: Buffer[] = []; const stderr: Buffer[] = []; childProcess.stdout.on('data', value => stdout.push(Buffer.from(value))); childProcess.stderr.on('data', value => stderr.push(Buffer.from(value))); childProcess.once('error', reject); childProcess.once('close', code => accept({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() })); childProcess.stdin.end(input) }) }
