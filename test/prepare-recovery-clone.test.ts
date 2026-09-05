import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prepareRecoveryClone,
  type RecoveryCloneBootstrapDependencies,
} from '../scripts/prepare-recovery-clone.js'

function fixture(storage: string, bundleId = 'bundle-1') {
  const calls: string[] = []
  const receipt = {
    mode: 'restore-safe' as const,
    bundleId,
    gitRevision: 'a'.repeat(40),
    preparedAt: '2026-09-06T00:00:00.000Z',
    runtimeEnvironment: 'var/restore-safe.env',
    pendingGates: ['account-reauthentication-or-reviewed-import'],
  }
  const dependencies: RecoveryCloneBootstrapDependencies = {
    createTemporaryRoot: async () => {
      calls.push('create-temp')
      return '/private/tmp/quark-bootstrap-test'
    },
    removeTemporaryRoot: async path => { calls.push(`remove:${path}`) },
    stage: async options => {
      calls.push(`stage:${options.outputDirectory}`)
      return { bundleId, storage }
    },
    prepareSqlite: async options => {
      calls.push(`sqlite:${options.stagingDirectory}`)
      return receipt
    },
    preparePostgres: async options => {
      calls.push(`postgres:${options.approvedBundleId}`)
      return receipt
    },
  }
  return { calls, receipt, dependencies }
}

test('stages and prepares SQLite through one safe entry, then removes plaintext staging', async () => {
  const context = fixture('sqlite')
  const receipt = await prepareRecoveryClone({
    input: '/backup/quark.age',
    identityFile: '/secrets/age.txt',
    projectRoot: '/fresh/clone',
    webPort: 13210,
  }, context.dependencies)
  assert.deepEqual(receipt, context.receipt)
  assert.deepEqual(context.calls, [
    'create-temp',
    'stage:/private/tmp/quark-bootstrap-test/staged',
    'sqlite:/private/tmp/quark-bootstrap-test/staged',
    'remove:/private/tmp/quark-bootstrap-test',
  ])
})

test('requires an exact PostgreSQL bundle approval and always removes staging', async () => {
  const context = fixture('postgres', 'bundle-pg')
  await assert.rejects(prepareRecoveryClone({
    input: '/backup/quark.age',
    identityFile: '/secrets/age.txt',
    projectRoot: '/fresh/clone',
    approvedBundleId: 'wrong-bundle',
    postgresUrl: 'postgres://localhost/restore',
  }, context.dependencies), /does not match/)
  assert.equal(context.calls.at(-1), 'remove:/private/tmp/quark-bootstrap-test')
  assert.equal(context.calls.some(call => call.startsWith('postgres:')), false)
})

test('passes PostgreSQL secrets outside argv only after exact approval', async () => {
  const context = fixture('postgres', 'bundle-pg')
  const receipt = await prepareRecoveryClone({
    input: '/backup/quark.age',
    identityFile: '/secrets/age.txt',
    projectRoot: '/fresh/clone',
    approvedBundleId: 'bundle-pg',
    postgresUrl: 'postgres://localhost/restore',
    environment: {},
  }, context.dependencies)
  assert.deepEqual(receipt, context.receipt)
  assert.ok(context.calls.includes('postgres:bundle-pg'))
  assert.equal(context.calls.at(-1), 'remove:/private/tmp/quark-bootstrap-test')
})

test('rejects unknown storage without leaving plaintext staging', async () => {
  const context = fixture('unknown')
  await assert.rejects(prepareRecoveryClone({
    input: '/backup/quark.age',
    identityFile: '/secrets/age.txt',
    projectRoot: '/fresh/clone',
  }, context.dependencies), /storage mode is unsupported/)
  assert.equal(context.calls.at(-1), 'remove:/private/tmp/quark-bootstrap-test')
})
