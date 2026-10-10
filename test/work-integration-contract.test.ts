import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalWorkExecutionContextV1, validateWorkPackManifestV1 } from '../src/work-integration/contracts.js'

const digest = `sha256:${'a'.repeat(64)}`

test('validates one closed product-neutral pack contract', () => {
  const manifest = validateWorkPackManifestV1(packManifest())
  assert.equal(manifest.packId, 'example-private-pack')
  assert.equal(manifest.recovery.restoreEffectsEnabled, false)
  assert.throws(() => validateWorkPackManifestV1({ ...packManifest(), companyWorkspace: true }), /unknown fields/)
  assert.throws(() => validateWorkPackManifestV1({ ...packManifest(), recovery: { stateNamespace: 'example-private-pack', restoreEffectsEnabled: true } }), /must remain false/)
})

test('gives Claude Code, Codex and DSH one identical privacy-bounded context', () => {
  const base = executionContext()
  const results = ['claude-code', 'codex', 'dsh'].map(actual => canonicalWorkExecutionContextV1({ ...base, executor: { ...base.executor, actual } }))
  for (const result of results) assert.doesNotMatch(result.bytes, /Users|token|password|secret/i)
  const normalized = results.map(result => JSON.parse(result.bytes)).map(value => ({ ...value, executor: { ...value.executor, actual: 'normalized' } }))
  assert.deepEqual(normalized[0], normalized[1]); assert.deepEqual(normalized[1], normalized[2])
  assert.throws(() => canonicalWorkExecutionContextV1({ ...base, inputs: { localPath: '/Users/example/private' } }), /sensitive or host-path/)
  assert.throws(() => canonicalWorkExecutionContextV1({ ...base, extraPrompt: 'second channel' }), /unknown fields/)
})

export function packManifest() {
  return {
    schemaVersion: 1, packId: 'example-private-pack', packVersion: '1.0.0',
    source: { revision: 'b'.repeat(40), artifactDigest: digest }, contract: { version: '1.0.0' },
    contributions: [{ id: 'example.context', version: '1.0.0', kind: 'context-enricher', ownershipKey: 'example.context', ownershipSemantics: 'exclusive', effectMode: 'none' }],
    requiredHostCapabilities: ['message.read', 'approval.verify'], dataClasses: ['work-metadata'],
    recovery: { stateNamespace: 'example-private-pack', restoreEffectsEnabled: false },
  }
}

function executionContext() {
  return {
    schemaVersion: 1, actionId: 'action:example', mode: 'offline-contract', approvalRef: null,
    idempotencyKey: 'idempotency:example', objective: 'Summarize bounded evidence.', inputs: { recordCount: 2 },
    sourceReferences: [{ kind: 'message', dataClass: 'work-metadata', opaqueReference: 'source:example' }],
    workspace: { handle: null, access: 'none', locality: 'local' }, capabilities: [{ id: 'message.read', version: '1.0.0' }],
    executor: { requested: 'claude-code', actual: 'claude-code', fallbackAllowed: true, midActionSwitchAllowed: false, continuityKey: null, priorFailureStage: null },
  }
}
