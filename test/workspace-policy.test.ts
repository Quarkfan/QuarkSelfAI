import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspacePolicy } from '../src/execution/workspace-policy.js'

test('allows files under configured roots and rejects traversal and symlink escapes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-workspace-'))
  const root = join(directory, 'allowed')
  const outside = join(directory, 'outside')
  await mkdir(root)
  await mkdir(outside)
  const insideFile = join(root, 'inside.txt')
  const outsideFile = join(outside, 'outside.txt')
  await writeFile(insideFile, 'inside')
  await writeFile(outsideFile, 'outside')
  await symlink(outsideFile, join(root, 'escaped.txt'))
  const policy = await WorkspacePolicy.create([root])
  const canonicalRoot = await realpath(root)
  assert.equal(await policy.authorizeExisting(insideFile), join(canonicalRoot, 'inside.txt'))
  assert.equal(await policy.authorizeCreation(join(root, 'new.txt')), join(canonicalRoot, 'new.txt'))
  await assert.rejects(policy.authorizeExisting(join(root, '..', 'outside', 'outside.txt')), /outside/)
  await assert.rejects(policy.authorizeExisting(join(root, 'escaped.txt')), /outside/)
})
