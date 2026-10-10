import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { publicCapabilityArtifactBytes, validatePublicCapabilityFormArtifacts } from '../src/capability-platform/form-artifact-evidence.js'
import type { ArtifactVerificationReportV1 } from '../src/client-runtime/contracts.js'
import { InactiveArtifactStoreV1 } from '../src/client-runtime/inactive-artifact-store.js'
import { planInactiveInstallation } from '../src/client-runtime/install-planner.js'
import { openSqliteInactiveClientState } from '../src/client-runtime/sqlite-client-state.js'

const git = promisify(execFile)
const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const artifactEvidence = new URL('../config/public-capability-form-artifacts.json', import.meta.url)
const at = new Date('2026-10-10T00:00:00.000Z')
const identity = { schemaVersion: 1 as const, tenantId: 'test.forms', userId: 'user.owner', deviceId: 'device.forms', publicKey: 'public.opaque', keyAlgorithm: 'ed25519' as const, createdAt: at.toISOString(), attestation: { kind: 'self' as const, reference: 'attestation.forms' } }
const checks = { license: 'pass', signature: 'pass', sbom: 'pass', malware: 'pass', maintenance: 'pass', dependencies: 'pass' } as const
const sha256 = (value: Uint8Array) => `sha256:${createHash('sha256').update(value).digest('hex')}`

test('verifies four signed public capability forms against their pinned repository sources', async () => {
  const document = validatePublicCapabilityFormArtifacts(JSON.parse(await readFile(artifactEvidence, 'utf8')))
  assert.deepEqual(document.artifacts.map(artifact => [artifact.form, artifact.manifest.kind]), [
    ['tool', 'cli'], ['package', 'package'], ['headless-browser', 'browser-runtime'], ['interactive-application', 'application'],
  ])
  for (const artifact of document.artifacts) {
    for (const file of artifact.files) {
      const source = await git('git', ['show', `${document.sourceRevision}:${file.path}`], { cwd: process.cwd(), encoding: 'buffer' })
      assert.equal(sha256(source.stdout), file.digest)
    }
    assert.equal(sha256(publicCapabilityArtifactBytes(document, artifact)), artifact.artifactBundleDigest)
    assert.deepEqual(artifact.lifecycleRehearsal, { status: 'verified-inactive', install: true, recover: true, uninstall: true,
      loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled' })
    assert.equal(artifact.activationAllowed, false)
    assert.equal(artifact.publicationAllowed, false)
  }
})

test('rehearses install, recovery and uninstall for every public form without loading, execution or effects', async () => {
  const document = validatePublicCapabilityFormArtifacts(JSON.parse(await readFile(artifactEvidence, 'utf8')))
  const directory = await mkdtemp(join(tmpdir(), 'quark-public-forms-'))
  const database = join(directory, 'client.sqlite3')
  const root = join(directory, 'artifacts')
  const state = await openSqliteInactiveClientState(database, migration, { verify: async () => true })
  try {
    state.enroll(identity, 'keychain:device.forms')
    const store = await InactiveArtifactStoreV1.open(root, state)
    for (const [index, artifact] of document.artifacts.entries()) {
      const source = join(directory, `artifact-${index}.json`)
      await writeFile(source, publicCapabilityArtifactBytes(document, artifact), { mode: 0o600 })
      const report: ArtifactVerificationReportV1 = { schemaVersion: 1, capabilityId: artifact.manifest.id, version: artifact.manifest.version,
        artifactDigest: artifact.artifactBundleDigest, sourceRevision: document.sourceRevision, policyRevision: 'public-forms.1', checks,
        decision: 'verified', evaluatedAt: at.toISOString() }
      const plan = planInactiveInstallation(artifact.manifest, report, identity.deviceId, new Date(at.getTime() + index * 1000))
      const receipt = await store.install(plan, source, new Date(at.getTime() + index * 1000))
      assert.deepEqual({ target: receipt.targetState, loading: receipt.loading, authorization: receipt.authorization, execution: receipt.execution, effects: receipt.effects },
        { target: 'installed-inactive', loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled' })
    }
    assert.deepEqual(await store.verifyRecovery(), { schemaVersion: 1, installedVersionCount: 4, selectedCapabilityCount: 4, orphanBlobCount: 0, orphanReceiptCount: 0,
      loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled' })
    assert.deepEqual({ installed: state.cloudProjection(at).installedCapabilityCount, active: state.cloudProjection(at).activeCapabilityCount,
      consumers: state.cloudProjection(at).ownedConsumers, providers: state.cloudProjection(at).ownedProviders,
      schedulers: state.cloudProjection(at).ownedSchedulers, effects: state.cloudProjection(at).externalWritesEnabled },
    { installed: 4, active: 0, consumers: 0, providers: 0, schedulers: 0, effects: false })
    for (const artifact of document.artifacts) {
      const result = await store.uninstall(artifact.manifest.id, artifact.manifest.version, new Date(at.getTime() + 10_000))
      assert.equal(result.cleanupPending, false)
      assert.equal(result.effects, 'disabled')
    }
    assert.equal((await store.verifyRecovery()).installedVersionCount, 0)
  } finally {
    await state.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects signature, digest and inactive-gate drift in public form evidence', async () => {
  const source = JSON.parse(await readFile(artifactEvidence, 'utf8'))
  assert.throws(() => validatePublicCapabilityFormArtifacts({ ...source, activationAllowed: true }), /inactive/)
  assert.throws(() => validatePublicCapabilityFormArtifacts({ ...source, signature: { ...source.signature, privateKeyPersisted: true } }), /signing policy/)
  const changedDigest = structuredClone(source); changedDigest.artifacts[0].files[0].digest = `sha256:${'0'.repeat(64)}`
  assert.throws(() => validatePublicCapabilityFormArtifacts(changedDigest), /bundle digest/)
  const changedSignature = structuredClone(source); changedSignature.artifacts[0].signatureBase64 = Buffer.alloc(64).toString('base64')
  assert.throws(() => validatePublicCapabilityFormArtifacts(changedSignature), /signature is invalid/)
})
