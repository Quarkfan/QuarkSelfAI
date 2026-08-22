import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectCompatibilityConfig } from '../src/migration/compat-preflight.js'

test('requires explicit migrated state, protected Dida auth and every local CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-compat-preflight-'))
  const bin = join(root, 'bin')
  const state = join(root, 'state')
  const home = join(root, 'home')
  await Promise.all([mkdir(bin), mkdir(state), mkdir(join(home, '.config', 'dida-cli'), { recursive: true })])
  for (const name of ['lark-cli', 'dida', 'claude', 'codex']) {
    const filename = join(bin, name)
    await writeFile(filename, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  }
  await writeFile(join(state, 'state.json'), JSON.stringify({ queue: [], mentionPending: [] }), { mode: 0o600 })
  const credential = join(home, '.config', 'dida-cli', 'config.json')
  await writeFile(credential, JSON.stringify({ access_token: 'fixture-secret' }), { mode: 0o600 })
  const config = join(root, 'config.json')
  await writeFile(config, JSON.stringify({
    allowedOpenId: 'owner', codexHome: root, workspaceRoot: root,
    didaProjectId: 'todo', followupProjectId: 'followup', varDir: state,
  }))
  try {
    const ready = await inspectCompatibilityConfig(config, { home, path: bin })
    assert.equal(ready.ready, true)
    assert.deepEqual(ready.blockers, [])
    await chmod(credential, 0o644)
    const unsafe = await inspectCompatibilityConfig(config, { home, path: bin })
    assert.equal(unsafe.ready, false)
    assert.ok(unsafe.blockers.includes('dida-credential-not-ready'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not silently fall back to a package-relative empty state directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-compat-preflight-var-'))
  const config = join(root, 'config.json')
  await writeFile(config, JSON.stringify({
    allowedOpenId: 'owner', codexHome: root, workspaceRoot: root,
    didaProjectId: 'todo', followupProjectId: 'followup',
  }))
  try {
    const report = await inspectCompatibilityConfig(config, { home: root, path: '' })
    assert.equal(report.explicitVarDir, false)
    assert.ok(report.blockers.includes('var-dir-not-explicit'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
