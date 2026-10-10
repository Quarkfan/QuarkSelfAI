import assert from 'node:assert/strict'
import test from 'node:test'
import { validateHeadlessBrowserLaunchV1 } from '../src/capability-platform/headless-browser-runtime.js'

test('models a no-effect ephemeral headless browser without launching one', () => {
  const request = validateHeadlessBrowserLaunchV1({ schemaVersion: 1, profile: 'ephemeral', network: 'blueprint-allowlist', downloads: 'denied', workspaceAccess: 'approved-read', desktopVisible: false, externalWritesEnabled: false })
  assert.equal(request.profile, 'ephemeral')
  assert.throws(() => validateHeadlessBrowserLaunchV1({ ...request, externalWritesEnabled: true }), /expands local effects/)
  assert.throws(() => validateHeadlessBrowserLaunchV1({ ...request, profile: 'persistent' }), /expands local effects/)
})
