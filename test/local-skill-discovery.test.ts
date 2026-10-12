import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { compileCapabilityDiscoveryIndex, discoverCapabilities } from '../src/capability-platform/discovery.js'
import { scanLocalSkillMetadata } from '../src/capability-platform/local-skill-scanner.js'

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'quark-skill-discovery-'))
}

async function skill(root: string, id: string, content: string): Promise<void> {
  const dir = join(root, id)
  await mkdir(dir)
  await writeFile(join(dir, 'SKILL.md'), content)
}

test('explicit root scan feeds the same inactive discovery index without body or paths', async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await skill(root, 'workspace-router', '---\nname: Workspace Router\ndescription: Route developer and product tasks to maintained sources.\n---\n\n# Private body\nsecret-body-marker\n')
  const descriptors = await scanLocalSkillMetadata([{ id: 'personal', path: root }])
  assert.equal(descriptors.length, 1)
  assert.equal(descriptors[0].id, 'personal/workspace-router')
  assert.doesNotMatch(JSON.stringify(descriptors), /secret-body-marker|quark-skill-discovery-/)
  const index = compileCapabilityDiscoveryIndex({ schemaVersion: 1, candidates: [] }, { schemaVersion: 1, sources: [] }, '2026-10-12', descriptors)
  const match = discoverCapabilities(index, 'product tasks')[0]
  assert.equal(match.id, 'skill:personal/workspace-router')
  assert.equal(match.executable, false)
  assert.equal(index.inspect(match.id)?.sourceVersion, descriptors[0].digest)
  assert.deepEqual(index.inspect(match.id)?.blockers, ['scope-review-missing', 'installation-and-execution-not-authorized'])
  assert.doesNotMatch(JSON.stringify(index.entries), /secret-body-marker|quark-skill-discovery-/)
})

test('rejects symlinks, duplicate roots, duplicate descriptors and oversized frontmatter', async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await skill(root, 'a', '---\nname: A\ndescription: Example.\n---\n')
  await assert.rejects(scanLocalSkillMetadata([{ id: 'one', path: root }, { id: 'one', path: root }]), /duplicate/)
  const descriptors = await scanLocalSkillMetadata([{ id: 'one', path: root }])
  assert.throws(() => compileCapabilityDiscoveryIndex({ schemaVersion: 1, candidates: [] }, { schemaVersion: 1, sources: [] }, '2026-10-12', [...descriptors, ...descriptors]), /duplicate/)
  await symlink(join(root, 'a'), join(root, 'linked'))
  await assert.rejects(scanLocalSkillMetadata([{ id: 'one', path: root }]), /symbolic link/)
  const large = await fixture()
  t.after(() => rm(large, { recursive: true, force: true }))
  await skill(large, 'huge', `---\nname: Huge\ndescription: ${'x'.repeat(9000)}\n---\n`)
  await assert.rejects(scanLocalSkillMetadata([{ id: 'two', path: large }]), /frontmatter/)
})

test('does not accept missing metadata or unbounded scan roots', async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await skill(root, 'bad', '---\nname: Bad\n---\n')
  await assert.rejects(scanLocalSkillMetadata([{ id: 'one', path: root }]), /description/)
  await assert.rejects(scanLocalSkillMetadata([]), /explicit roots/)
})
