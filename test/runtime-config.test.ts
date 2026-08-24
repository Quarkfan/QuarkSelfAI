import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRuntimeConfig } from '../src/config/runtime.js'
import { loadExecutionConfig } from '../src/execution/config.js'
import { loadAssistantKernelConfig } from '../src/runtime/kernel-config.js'
import { loadStorageConfig } from '../src/storage/config.js'
import { loadConsoleConfig } from '../src/web/config.js'

test('loads stable kernel configuration without feature or migration selectors', () => {
  const config = loadAssistantKernelConfig({}, '/srv/quark')
  assert.deepEqual(config.kernel, {
    mode: 'dsh',
    command: 'dsh',
    args: ['--profile', 'assistant', '--no-open'],
    cwd: '/srv/quark',
    home: '/srv/quark/var/dsh',
    profile: 'assistant',
  })
  assert.equal('runtime' in config, false)
  assert.equal('storage' in config, false)
})

test('loads execution and console features independently from the kernel skeleton', () => {
  const execution = loadExecutionConfig({}, '/srv/quark')
  const console = loadConsoleConfig({}, execution)
  assert.deepEqual(execution, { mode: 'local', workspaceRoots: ['/srv/quark'] })
  assert.equal(console.web.host, '127.0.0.1')
  assert.equal(console.web.port, 3210)
})

test('allows the DSH kernel to be disabled only as an explicit diagnostic mode', () => {
  const config = loadAssistantKernelConfig({ ASSISTANT_KERNEL: 'off' }, '/srv/quark')
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
  const config = loadStorageConfig({
    ASSISTANT_STORAGE: 'postgres',
    DATABASE_URL: 'postgresql://example.invalid/quark',
  })
  assert.deepEqual(config, {
    kind: 'postgres',
    databaseUrl: 'postgresql://example.invalid/quark',
  })
})

test('keeps SQLite selection inside the replaceable storage provider', () => {
  assert.deepEqual(loadStorageConfig({}, '/srv/quark'), {
    kind: 'sqlite', path: '/srv/quark/var/quarkselfai.sqlite3',
  })
})

test('refuses an unauthenticated non-loopback console', () => {
  assert.throws(() => loadConsoleConfig({ WEB_HOST: '0.0.0.0' }, { mode: 'local', workspaceRoots: ['/srv/quark'] }), /CONSOLE_TOKEN is required/)
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
  assert.equal(config.kernel.mode === 'dsh' && config.kernel.profile, 'feishu-assistant')
})

test('requires an authenticated control plane for the compatibility controller', () => {
  assert.throws(() => loadRuntimeConfig({
    ASSISTANT_RUNTIME: 'compat',
    COMPAT_CONFIG_PATH: './bridge.json',
    TAKEOVER_CONFIRMED: 'true',
  }), /CONTROL_PLANE_TOKEN is required/)
})

test('accepts an explicit local workspace allowlist', () => {
  const config = loadExecutionConfig({
    ASSISTANT_WORKSPACE_ROOTS: '["/Users/edy/BlackLakeWork","/private/tmp/shared"]',
  })
  assert.deepEqual(config, {
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
