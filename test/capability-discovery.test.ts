import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { compileCapabilityDiscoveryIndex, discoverCapabilities } from '../src/capability-platform/discovery.js'

async function index(now = '2026-10-12T00:00:00Z') {
  const candidates = JSON.parse(await readFile(new URL('../config/capability-artifact-candidates.json', import.meta.url), 'utf8'))
  const external = JSON.parse(await readFile(new URL('../config/external-capability-sources.json', import.meta.url), 'utf8'))
  return compileCapabilityDiscoveryIndex(candidates, external, now)
}

test('discovers existing sources through lightweight refs, with inactive detail on demand', async () => {
  const catalog = await index()
  assert.equal(catalog.entries.length, 27)
  assert.ok(catalog.entries.every(item => item.executable === false && !('blockers' in item)))
  const feishu = discoverCapabilities(catalog, 'Feishu messaging')
  assert.equal(feishu[0]?.id, 'capability:feishu-messaging')
  assert.deepEqual(feishu[0]?.matchReason, ['feishu', 'messaging'])
  const detail = catalog.inspect(feishu[0].id)
  assert.equal(detail?.state, 'candidate-inactive')
  assert.ok(detail?.blockers.includes('permission-review-missing'))
  assert.equal(catalog.inspect('capability:missing'), undefined)
})

test('external source is reference-only, stale when review expires, and never outranks a matching first-party candidate', async () => {
  const catalog = await index('2026-12-01T00:00:00Z')
  const monid = discoverCapabilities(catalog, 'monid')[0]
  assert.equal(monid.id, 'external:monid')
  assert.equal(monid.state, 'stale-inactive')
  assert.equal(monid.executable, false)
  assert.match(catalog.inspect(monid.id)!.sourceUrl!, /^https:\/\//)
  const mixed = compileCapabilityDiscoveryIndex({ schemaVersion: 1, candidates: [{ id: 'monid-tool', name: 'Monid Tool', kind: 'cli', blockers: [], activationAllowed: false, publicationAllowed: false }] },
    { schemaVersion: 1, sources: [{ id: 'monid', kind: 'external-endpoint-marketplace', state: 'catalogued-inactive', activationAllowed: false, installationAllowed: false, liveCallsAllowed: false, blockers: [], reviewBy: '2026-12-31', reference: 'docs/monid.md', observedSkillVersion: '1', sourceUrl: 'https://monid.ai' }] }, '2026-10-12T00:00:00Z')
  assert.equal(discoverCapabilities(mixed, 'monid')[0].id, 'capability:monid-tool')
})

test('fails closed on duplicate records, active external source, unbounded query and invalid limits', async () => {
  const catalog = await index()
  assert.deepEqual(discoverCapabilities(catalog, 'no-such-capability-zz'), [])
  assert.equal(discoverCapabilities(catalog, 'capability', 1).length, 1)
  assert.throws(() => discoverCapabilities(catalog, ' ', 1), /query/)
  assert.throws(() => discoverCapabilities(catalog, 'x', 51), /limit/)
  const first = { id: 'x', name: 'X', kind: 'tool', blockers: [], activationAllowed: false, publicationAllowed: false }
  assert.throws(() => compileCapabilityDiscoveryIndex({ schemaVersion: 1, candidates: [first, first] }, { schemaVersion: 1, sources: [] }, '2026-10-12'), /duplicate/)
  assert.throws(() => compileCapabilityDiscoveryIndex({ schemaVersion: 1, candidates: [] }, { schemaVersion: 1, sources: [{ id: 'x', state: 'active' }] }, '2026-10-12'), /inactive external/)
})
