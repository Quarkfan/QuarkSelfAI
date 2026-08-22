import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRuntimeConfig } from '../src/config/runtime.js'

test('uses SQLite on loopback by default', () => {
  const config = loadRuntimeConfig({}, '/srv/quark')
  assert.deepEqual(config.storage, { kind: 'sqlite', path: '/srv/quark/var/quarkselfai.sqlite3' })
  assert.equal(config.web.host, '127.0.0.1')
  assert.equal(config.web.port, 3210)
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
  }, '/srv/quark')
  assert.deepEqual(config.runtime, { mode: 'compat', configPath: '/srv/quark/bridge.json' })
})
