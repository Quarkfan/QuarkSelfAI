import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installInactiveClient, type InactiveClientInstallationV1 } from '../src/client-runtime/client-installation.js'
import { compileClientEntryCommand } from '../src/client-runtime/client-entry.js'
import { InstalledNoEffectClientProcessV1, type OwnedConfiguredClientPortV1 } from '../src/client-runtime/installed-client-process.js'
import { createClientDistributionFixture } from './client-distribution-fixture.js'

function installation(): InactiveClientInstallationV1 { return { plan: {} as never, receipt: { schemaVersion: 1, installationId: `installation.${'a'.repeat(32)}`, clientVersion: '0.1.0', configDigest: `sha256:${'b'.repeat(64)}`, migrationDigest: `sha256:${'c'.repeat(64)}`, distributionDigest: `sha256:${'d'.repeat(64)}`, sourceRevision: 'e'.repeat(40), installedAt: '2026-09-06T00:00:00.000Z', state: 'installed-inactive', autoStart: false, externalWritesEnabled: false } } }
const execFileAsync = promisify(execFile)
const at = new Date('2026-09-06T00:00:00.000Z')

test('opens inertly and closes the worker before the configured client owner', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'quark-installed-client-'))); const events: string[] = []
  const client = { async close() { events.push('client.close') } } as OwnedConfiguredClientPortV1
  try {
    const owner = await InstalledNoEffectClientProcessV1.open('/unused', { schemaVersion: 1, enabled: true, workspacePath: workspace, cycleIntervalMs: 5_000, discoveryIntervalMs: 30_000, externalWritesEnabled: false }, {
      recover: async () => installation(), initialize: async () => client,
      createWorker: async () => ({ start() { events.push('worker.start') }, async stop() { events.push('worker.stop') }, snapshot() { return { schemaVersion: 1, state: 'stopped', passCount: 0, lastPassAt: null, lastDiscoveryAt: null, lastReceiptState: null, lastFailure: null, externalWritesEnabled: false } } }) as never,
    })
    assert.deepEqual(events, []); assert.equal(owner.snapshot().installationId, `installation.${'a'.repeat(32)}`); assert.equal(JSON.stringify(owner.snapshot()).includes('/unused'), false)
    owner.start(); await owner.close(); await owner.close()
    assert.deepEqual(events, ['worker.start', 'worker.stop', 'client.close'])
    assert.throws(() => owner.start(), /closed/)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('closes the configured client when worker construction fails', async () => {
  let closes = 0
  await assert.rejects(InstalledNoEffectClientProcessV1.open('/unused', {} as never, { recover: async () => installation(), initialize: async () => ({ async close() { closes += 1 } }) as OwnedConfiguredClientPortV1, createWorker: async () => { throw new Error('worker failed') } }), /worker failed/)
  assert.equal(closes, 1)
})

test('compiles a closed status command and requires exact opt-in for run', () => {
  assert.deepEqual(compileClientEntryCommand(['status'], { QUARK_CLIENT_INSTALL_ROOT: '/opt/quark-client' }), { mode: 'status', installRoot: '/opt/quark-client' })
  assert.throws(() => compileClientEntryCommand(['run'], { QUARK_CLIENT_INSTALL_ROOT: '/opt/quark-client', QUARK_CLIENT_WORKSPACE: '/workspace' }), /not explicitly enabled/)
  assert.deepEqual(compileClientEntryCommand(['run'], { QUARK_CLIENT_INSTALL_ROOT: '/opt/quark-client', QUARK_CLIENT_WORKSPACE: '/workspace', QUARK_CLIENT_ENABLE_NO_EFFECT_WORKER: '1' }), { mode: 'run', installRoot: '/opt/quark-client', worker: { schemaVersion: 1, enabled: true, workspacePath: '/workspace', cycleIntervalMs: 30_000, discoveryIntervalMs: 300_000, externalWritesEnabled: false } })
  assert.throws(() => compileClientEntryCommand(['run', 'extra'], { QUARK_CLIENT_INSTALL_ROOT: '/opt/quark-client' }), /exactly/)
  assert.throws(() => compileClientEntryCommand(['run'], { QUARK_CLIENT_INSTALL_ROOT: '/opt/quark-client', QUARK_CLIENT_WORKSPACE: '/workspace', QUARK_CLIENT_ENABLE_NO_EFFECT_WORKER: '1', QUARK_CLIENT_CYCLE_INTERVAL_MS: '1e3' }), /interval/)
})

test('runs the built status entry against a real inactive installation without opening client state', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-installed-client-status-'))); const installRoot = join(parent, 'client')
  const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
  try {
    const distributionSourcePath = await createClientDistributionFixture(parent, `import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; const receipt=JSON.parse(await readFile(join(process.env.QUARK_CLIENT_INSTALL_ROOT,'install-receipt.json'),'utf8')); process.stdout.write(JSON.stringify({schemaVersion:1,installationId:receipt.installationId,clientVersion:receipt.clientVersion,state:receipt.state,autoStart:false,externalWritesEnabled:false})+'\\n')\n`)
    const installed = await installInactiveClient({ installRoot, distributionSourcePath, clientVersion: '0.1.0', controlPlaneEndpoint: 'https://control.example.com/', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner', planVerification: { keyId: 'control.primary', publicKey } }, at)
    const { stdout, stderr } = await execFileAsync(process.execPath, [join(installRoot, 'program/dist/client-runtime/client-entry.js'), 'status'], { cwd: join(installRoot, 'program'), env: { ...process.env, QUARK_CLIENT_INSTALL_ROOT: installRoot } })
    const status = JSON.parse(stdout)
    assert.deepEqual(status, { schemaVersion: 1, installationId: installed.receipt.installationId, clientVersion: '0.1.0', state: 'installed-inactive', autoStart: false, externalWritesEnabled: false })
    assert.equal(stderr, ''); assert.equal(stdout.includes(installRoot), false); assert.deepEqual(await readdir(join(installRoot, 'state')), [])
  } finally { await rm(parent, { recursive: true, force: true }) }
})
