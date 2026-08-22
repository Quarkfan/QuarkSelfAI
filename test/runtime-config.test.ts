import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRuntimeConfig } from '../src/config/runtime.js'

test('uses SQLite on loopback by default', () => {
  const config = loadRuntimeConfig({}, '/srv/quark')
  assert.deepEqual(config.storage, { kind: 'sqlite', path: '/srv/quark/var/quarkselfai.sqlite3' })
  assert.equal(config.web.host, '127.0.0.1')
  assert.equal(config.web.port, 3210)
  assert.deepEqual(config.execution, { mode: 'local', workspaceRoots: ['/srv/quark'] })
  assert.deepEqual(config.kernel, {
    mode: 'dsh',
    command: 'dsh',
    args: ['--profile', 'feishu-assistant', '--no-open'],
    cwd: '/srv/quark',
    home: '/srv/quark/var/dsh',
    profile: 'feishu-assistant',
  })
})

test('allows the DSH kernel to be disabled only as an explicit diagnostic mode', () => {
  const config = loadRuntimeConfig({ ASSISTANT_KERNEL: 'off' }, '/srv/quark')
  assert.deepEqual(config.kernel, { mode: 'off' })
})

test('cannot cut over the compatibility consumer with the DSH kernel disabled', () => {
  assert.throws(() => loadRuntimeConfig({
    ASSISTANT_RUNTIME: 'compat',
    ASSISTANT_KERNEL: 'off',
    COMPAT_CONFIG_PATH: '/srv/quark/bridge.json',
    TAKEOVER_CONFIRMED: 'true',
    CONTROL_PLANE_TOKEN: 'test-token',
  }, '/srv/quark'), /requires ASSISTANT_KERNEL=dsh/)
})

test('selects PostgreSQL from configuration', () => {
  const config = loadRuntimeConfig({
    ASSISTANT_STORAGE: 'postgres',
    DATABASE_URL: 'postgresql://example.invalid/quark',
  })
  assert.deepEqual(config.storage, {
    kind: 'postgres',
    databaseUrl: 'postgresql://example.invalid/quark',
  })
})

test('refuses an unauthenticated non-loopback console', () => {
  assert.throws(() => loadRuntimeConfig({ WEB_HOST: '0.0.0.0' }), /CONSOLE_TOKEN is required/)
})

test('rejects an ambiguous Lark identity', () => {
  assert.throws(() => loadRuntimeConfig({ LARK_IDENTITY: 'auto' }), /LARK_IDENTITY must be user or bot/)
})

test('keeps the compatibility consumer disabled without an explicit takeover confirmation', () => {
  assert.throws(() => loadRuntimeConfig({
    ASSISTANT_RUNTIME: 'compat',
    COMPAT_CONFIG_PATH: './bridge.json',
  }, '/srv/quark'), /TAKEOVER_CONFIRMED=true/)
})

test('resolves a compatibility config only after both startup gates are present', () => {
  const config = loadRuntimeConfig({
    ASSISTANT_RUNTIME: 'compat',
    COMPAT_CONFIG_PATH: './bridge.json',
    TAKEOVER_CONFIRMED: 'true',
    CONTROL_PLANE_TOKEN: 'internal-test-token',
  }, '/srv/quark')
  assert.deepEqual(config.runtime, { mode: 'compat', configPath: '/srv/quark/bridge.json' })
})

test('requires an authenticated control plane for the compatibility controller', () => {
  assert.throws(() => loadRuntimeConfig({
    ASSISTANT_RUNTIME: 'compat',
    COMPAT_CONFIG_PATH: './bridge.json',
    TAKEOVER_CONFIRMED: 'true',
  }), /CONTROL_PLANE_TOKEN is required/)
})

test('accepts an explicit local workspace allowlist', () => {
  const config = loadRuntimeConfig({
    ASSISTANT_WORKSPACE_ROOTS: '["/Users/edy/BlackLakeWork","/private/tmp/shared"]',
  })
  assert.deepEqual(config.execution, {
    mode: 'local',
    workspaceRoots: ['/Users/edy/BlackLakeWork', '/private/tmp/shared'],
  })
})

test('remote execution cannot start the local compatibility provider', () => {
  assert.throws(() => loadRuntimeConfig({
    ASSISTANT_EXECUTION_MODE: 'remote',
    ASSISTANT_RUNTIME: 'compat',
    COMPAT_CONFIG_PATH: '/srv/quark/bridge.json',
    TAKEOVER_CONFIRMED: 'true',
    CONTROL_PLANE_TOKEN: 'test-token',
  }), /requires ASSISTANT_EXECUTION_MODE=local/)
})
