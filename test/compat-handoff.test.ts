import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareCompatibilityHandoff } from '../src/migration/compat-handoff.js'

test('prepares a content-addressed, non-overwriting compatibility handoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-compat-handoff-'))
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  const destination = join(root, 'staging')
  const legacyDidaDirectory = join(root, 'legacy-dida')
  await Promise.all([
    mkdir(bin),
    mkdir(join(home, '.config', 'dida-cli'), { recursive: true }),
    mkdir(join(legacyDidaDirectory, 'projection-1'), { recursive: true }),
  ])
  const executables = {
    larkCli: join(bin, 'lark-cli'),
    didaCli: join(bin, 'dida'),
    claudeCli: join(bin, 'claude'),
    codexCli: join(bin, 'codex'),
  }
  for (const filename of Object.values(executables)) await writeFile(filename, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const didaCliConfigPath = join(home, '.config', 'dida-cli', 'config.json')
  await writeFile(didaCliConfigPath, JSON.stringify({ access_token: 'fixture' }), { mode: 0o600 })
  const legacyConfigPath = join(root, 'legacy-config.json')
  const legacyStatePath = join(root, 'legacy-state.json')
  await writeFile(legacyConfigPath, JSON.stringify({
    allowedOpenId: 'owner', codexHome: root, workspaceRoot: root, didaProjectId: 'todo', followupProjectId: 'followup',
  }))
  await writeFile(legacyStatePath, JSON.stringify({ queue: [], mentionPending: [] }))
  await writeFile(join(legacyDidaDirectory, 'projection-1', 'result.json'), JSON.stringify({ taskAction: 'ignored' }))
  const before = createHash('sha256').update(await readFile(legacyStatePath)).digest('hex')
  try {
    const options = {
      legacyConfigPath, legacyStatePath, legacyDidaDirectory, destinationRoot: destination, home, path: bin, executables, didaCliConfigPath,
    }
    const first = await prepareCompatibilityHandoff(options)
    assert.equal(first.reused, false)
    assert.equal(first.handoffSafe, true)
    assert.equal((await stat(first.configPath)).mode & 0o777, 0o600)
    assert.equal((await stat(first.statePath)).mode & 0o777, 0o600)
    assert.equal((await stat(first.evidenceManifestPath)).mode & 0o777, 0o600)
    assert.equal(first.didaFiles, 1)
    const evidence = JSON.parse(await readFile(first.evidenceManifestPath, 'utf8')) as {
      dida: { files: Array<{ path: string; sha256: string }> }
    }
    assert.equal(evidence.dida.files[0]?.path, 'projection-1/result.json')
    assert.equal(await readFile(join(first.didaPath, 'projection-1', 'result.json'), 'utf8'), JSON.stringify({ taskAction: 'ignored' }))
    const prepared = JSON.parse(await readFile(first.configPath, 'utf8')) as Record<string, unknown>
    assert.equal(prepared.varDir, first.directory)
    assert.equal(prepared.didaCli, executables.didaCli)
    const second = await prepareCompatibilityHandoff(options)
    assert.equal(second.reused, true)
    assert.equal(second.directory, first.directory)
    assert.equal(createHash('sha256').update(await readFile(legacyStatePath)).digest('hex'), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
