import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateHeadlessBrowserLaunchV1 } from '../src/capability-platform/headless-browser-runtime.js'
import { LocalHeadlessBrowserAdapterV1 } from '../src/capability-platform/local-headless-browser-adapter.js'

test('models a no-effect ephemeral headless browser without launching one', () => {
  const request = validateHeadlessBrowserLaunchV1({ schemaVersion: 1, profile: 'ephemeral', network: 'blueprint-allowlist', downloads: 'denied', workspaceAccess: 'approved-read', desktopVisible: false, externalWritesEnabled: false })
  assert.equal(request.profile, 'ephemeral')
  assert.throws(() => validateHeadlessBrowserLaunchV1({ ...request, externalWritesEnabled: true }), /expands local effects/)
  assert.throws(() => validateHeadlessBrowserLaunchV1({ ...request, profile: 'persistent' }), /expands local effects/)
})

test('starts and stops one denied-effect browser process with an ephemeral profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-headless-browser-'))
  const adapter = new LocalHeadlessBrowserAdapterV1({ executable: process.execPath, leadingArguments: [new URL('fixtures/fake-headless-browser.mjs', import.meta.url).pathname] }, { profileParent: root, startupProbeMs: 25 })
  try {
    const request = validateHeadlessBrowserLaunchV1({ schemaVersion: 1, profile: 'ephemeral', network: 'denied', downloads: 'denied', workspaceAccess: 'denied', desktopVisible: false, externalWritesEnabled: false })
    const started = await adapter.start(request)
    assert.equal(started.state, 'started')
    assert.equal(started.externalWritesEnabled, false)
    assert.equal(adapter.activeSessionCount(), 1)
    assert.equal((await readdir(root)).length, 1)
    assert.equal((await adapter.stop(started.sessionId)).state, 'stopped')
    assert.equal(adapter.activeSessionCount(), 0)
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(adapter.stop(started.sessionId), /not active/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects policy-expanding declarations before creating a profile or process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-headless-browser-'))
  const adapter = new LocalHeadlessBrowserAdapterV1({ executable: process.execPath, leadingArguments: [new URL('fixtures/fake-headless-browser.mjs', import.meta.url).pathname] }, { profileParent: root })
  try {
    const request = validateHeadlessBrowserLaunchV1({ schemaVersion: 1, profile: 'ephemeral', network: 'blueprint-allowlist', downloads: 'denied', workspaceAccess: 'denied', desktopVisible: false, externalWritesEnabled: false })
    await assert.rejects(adapter.start(request), /only denied network and workspace/)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
