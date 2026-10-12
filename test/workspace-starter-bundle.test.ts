import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { inspectWorkspaceStarterBundleBytes } from '../src/capability-platform/workspace-starter-bundle.js'

const revision = 'a'.repeat(40)
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}` }
  return JSON.stringify(value)
}
function sha(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function fixture(): { raw: Buffer; digest: string; bundle: Record<string, unknown> } {
  const config = JSON.stringify({ schema_version: 1, profile: 'developer', core_channel: { id: 'feishu', required: true, adapter: 'lark-cli', readiness_owner: 'host-runtime' }, permissions: { external_writes: 'confirm-each', network: 'disabled-by-default' }, sources: [{ id: 'router', path: 'skills/workspace-router/SKILL.md' }] })
  const files = new Map([
    ['AGENTS.md', '# Agent\n'], ['CLAUDE.md', '# Entry\n'], ['docs/INDEX.md', '# Index\n'],
    ['skills/workspace-router/SKILL.md', '---\nname: workspace-router\ndescription: Synthetic.\n---\nprivate-body-marker\n'],
    ['workspace.json', config],
  ])
  const entries = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, size: Buffer.byteLength(content), digest: sha(Buffer.from(content)), content_base64: Buffer.from(content).toString('base64') }))
  const unsigned = { schema_version: 1, bundle_id: 'agent-workspace-starter', bundle_version: '0.1.0', profile: 'developer', source_revision: revision, core_channel: { adapter: 'lark-cli', id: 'feishu', required: true }, state: 'inactive', external_writes_enabled: false, files: entries }
  const digest = sha(Buffer.from(`${canonical({ ...unsigned, files: entries.map(({ path, size, digest }) => ({ path, size, digest })) })}\n`))
  const bundle = { ...unsigned, artifact_digest: digest }
  return { raw: Buffer.from(`${canonical(bundle)}\n`), digest, bundle }
}

test('inspects a pinned inactive bundle without returning content or paths', () => {
  const sample = fixture()
  const view = inspectWorkspaceStarterBundleBytes(sample.raw, { sourceRevision: revision, artifactDigest: sample.digest })
  assert.equal(view.fileCount, 5)
  assert.equal(view.profile, 'developer')
  assert.equal(view.executable, false)
  assert.equal(view.externalWritesEnabled, false)
  assert.doesNotMatch(JSON.stringify(view), /private-body-marker|SKILL\.md|workspace\.json/)
})

test('rejects mismatched pins, mutable state, unsafe paths and tampered file bytes', () => {
  const sample = fixture()
  assert.throws(() => inspectWorkspaceStarterBundleBytes(sample.raw, { sourceRevision: 'b'.repeat(40), artifactDigest: sample.digest }), /pin/)
  assert.throws(() => inspectWorkspaceStarterBundleBytes(sample.raw, { sourceRevision: revision, artifactDigest: `sha256:${'b'.repeat(64)}` }), /pin/)
  const altered = (edit: (value: any) => void): Buffer => { const value = structuredClone(sample.bundle); edit(value); return Buffer.from(`${canonical(value)}\n`) }
  assert.throws(() => inspectWorkspaceStarterBundleBytes(altered(value => { value.state = 'active' }), { sourceRevision: revision, artifactDigest: sample.digest }), /activation/)
  assert.throws(() => inspectWorkspaceStarterBundleBytes(altered(value => { value.files[0].path = '.git/config' }), { sourceRevision: revision, artifactDigest: sample.digest }), /path/)
  assert.throws(() => inspectWorkspaceStarterBundleBytes(altered(value => { const entry = value.files[2]; value.files.splice(3, 0, { ...entry, path: 'docs/X.md' }, { ...entry, path: 'docs/x.md' }) }), { sourceRevision: revision, artifactDigest: sample.digest }), /collision/)
  assert.throws(() => inspectWorkspaceStarterBundleBytes(altered(value => { value.files[0].content_base64 = 'AAAA' }), { sourceRevision: revision, artifactDigest: sample.digest }), /integrity/)
  assert.throws(() => inspectWorkspaceStarterBundleBytes(Buffer.from(JSON.stringify(sample.bundle, null, 2)), { sourceRevision: revision, artifactDigest: sample.digest }), /canonical/)
})
