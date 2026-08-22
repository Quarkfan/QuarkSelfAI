import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { snapshotLegacyState } from '../src/migration/state-snapshot.js'

test('copies legacy state content-addressably without changing the source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-state-snapshot-'))
  const source = join(root, 'state.json')
  const destination = join(root, 'snapshots')
  const contents = Buffer.from(JSON.stringify({ queue: [], cursor: 'stable' }))
  await writeFile(source, contents, { mode: 0o600 })

  const first = await snapshotLegacyState(source, destination)
  const second = await snapshotLegacyState(source, destination)
  assert.equal(first.reused, false)
  assert.equal(second.reused, true)
  assert.equal(second.snapshot, first.snapshot)
  assert.deepEqual(await readFile(source), contents)
  assert.deepEqual(await readFile(first.snapshot), contents)
  assert.equal((await stat(first.snapshot)).mode & 0o777, 0o600)
})
