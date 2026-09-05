import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { computeWorkDomainInventory } from '../scripts/audit-work-domain-isolation.js'

const exec = promisify(execFile)

function config(baseline: { pathCount: number; pathDigest: string; evidenceDigest: string }) {
  return {
    schemaVersion: 1,
    projectId: 'quarkselfai',
    status: 'migration-inventory',
    markers: ['legacy-work', '专用工作域'],
    excludedRegistryPaths: ['config/work-domain-isolation.json', 'scripts/audit-work-domain-isolation.ts'],
    baseline,
    classificationRules: [
      { id: 'runtime-integration', disposition: 'private-pack', prefixes: ['src/'] },
      { id: 'governance-history', disposition: 'redact-or-retire', prefixes: ['docs/'] },
    ],
  }
}

test('keeps a content-sensitive inventory of every tracked work-domain reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-work-domain-inventory-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'src', 'integration.ts'), 'export const provider = "legacy-work"\n')
  await writeFile(join(root, 'docs', 'history.md'), '# 专用工作域迁移\n')
  await writeFile(join(root, 'README.md'), '# Generic product\n')
  await exec('git', ['init'], { cwd: root })
  await exec('git', ['add', '.'], { cwd: root })

  const placeholder = '0'.repeat(64)
  const initial = computeWorkDomainInventory(root, config({ pathCount: 0, pathDigest: placeholder, evidenceDigest: placeholder }))
  assert.equal(initial.pathCount, 2)
  assert.deepEqual(initial.counts, { 'runtime-integration': 1, 'governance-history': 1 })
  const exact = config({ pathCount: initial.pathCount, pathDigest: initial.pathDigest, evidenceDigest: initial.evidenceDigest })
  assert.equal(computeWorkDomainInventory(root, exact).ok, true)

  await writeFile(join(root, 'src', 'integration.ts'), 'export const provider = "legacy-work-v2"\n')
  const changed = computeWorkDomainInventory(root, exact)
  assert.equal(changed.ok, false)
  assert.equal(changed.drift.evidenceDigest, true)

  await writeFile(join(root, 'unowned.txt'), 'legacy-work\n')
  await exec('git', ['add', 'unowned.txt'], { cwd: root })
  const unowned = computeWorkDomainInventory(root, exact)
  assert.equal(unowned.ok, false)
  assert.deepEqual(unowned.unclassified, ['unowned.txt'])
  assert.equal(unowned.drift.pathDigest, true)
})
