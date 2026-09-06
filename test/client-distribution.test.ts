import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyClientDistribution } from '../src/client-runtime/client-distribution.js'
import { createClientDistributionFixture } from './client-distribution-fixture.js'

test('seals and verifies a path-free inactive client distribution', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-distribution-')))
  try {
    const root = await createClientDistributionFixture(parent); const manifest = await verifyClientDistribution(root)
    assert.equal(manifest.clientVersion, '0.1.0'); assert.equal(manifest.sourceRevision, 'a'.repeat(40)); assert.equal(manifest.autoStart, false); assert.equal(manifest.externalWritesEnabled, false)
    assert.equal(JSON.stringify(manifest).includes(parent), false)
    assert.deepEqual(manifest.files.map(file => file.path), [...manifest.files.map(file => file.path)].sort())
    const bytes = await readFile(join(root, 'program/dist/client-runtime/client-entry.js')); await writeFile(join(root, 'program/dist/client-runtime/client-entry.js'), Buffer.concat([bytes, Buffer.from('tamper')]), { mode: 0o600 })
    await assert.rejects(verifyClientDistribution(root), /inventory drifted/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('rejects public distribution files', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'quark-client-distribution-')))
  try { const root = await createClientDistributionFixture(parent); await chmod(join(root, 'program/package.json'), 0o644); await assert.rejects(verifyClientDistribution(root), /file is unsafe/) }
  finally { await rm(parent, { recursive: true, force: true }) }
})
