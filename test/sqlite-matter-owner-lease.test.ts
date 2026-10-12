import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { openSqliteInactiveMatterOwnerLeaseV1 } from '../src/control-plane/sqlite-matter-owner-lease.js'

const migrations = ['001_tenant_identity.sql', '004_device_sessions.sql', '008_matter_owner_lease.sql']
  .map(name => new URL(`../migrations/control-plane-sqlite/${name}`, import.meta.url).pathname)
const at = new Date('2026-10-12T00:00:00.000Z')
const later = new Date(at.getTime() + 61_000)
const digest = `sha256:${'a'.repeat(64)}`
const transferInput = { expectedEpoch: 1, recoveryDigest: digest, approvalDigest: digest }

async function fixture(): Promise<{ database: string; dispose: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'quark-matter-owner-'))
  const database = join(directory, 'control.sqlite3')
  const db = new DatabaseSync(database)
  try {
    for (const migration of migrations) db.exec(await readFile(migration, 'utf8'))
    const insertTenant = db.prepare(`INSERT INTO cp_tenant VALUES (?,?,?,?)`)
    const insertUser = db.prepare(`INSERT INTO cp_user VALUES (?,?,?,?,?)`)
    const insertDevice = db.prepare(`INSERT INTO cp_device VALUES (?,?,?,?,?,?)`)
    const insertSession = db.prepare(`INSERT INTO cp_device_session VALUES (?,?,?,?,?,?,?)`)
    for (const tenant of ['alpha', 'beta']) {
      insertTenant.run(tenant, tenant, 'test', at.toISOString())
      insertUser.run(tenant, 'owner', 'Owner', 'active', at.toISOString())
      for (const device of ['one', 'two']) {
        insertDevice.run(tenant, device, 'owner', `key.${device}`, 'registered', at.toISOString())
        insertSession.run(`${tenant}.${device}`, tenant, 'owner', device, at.toISOString(), new Date(at.getTime() + 3_600_000).toISOString(), 'active')
      }
    }
  } finally { db.close() }
  return { database, dispose: () => rm(directory, { recursive: true, force: true }) }
}

test('one scoped owner survives restart; expiry alone cannot transfer', async () => {
  const f = await fixture()
  try {
    const first = await openSqliteInactiveMatterOwnerLeaseV1(f.database, migrations, { verify: async () => false }, () => later)
    const second = await openSqliteInactiveMatterOwnerLeaseV1(f.database, migrations, { verify: async () => false }, () => later)
    try {
      assert.equal(first.claim('alpha.one', 'work', undefined, at).epoch, 1)
      assert.equal(first.verifyCurrent('alpha.one', 'work', 1, at), true)
      assert.equal(second.verifyCurrent('alpha.two', 'work', 1, at), false)
      assert.throws(() => second.claim('alpha.two', 'work', 1, later), /another device/)
      assert.equal(second.claim('alpha.one', 'work', 1, later).epoch, 1)
      assert.throws(() => first.claim('alpha.one', 'work', 2, later), /epoch/)
      assert.equal(second.claim('beta.one', 'work', undefined, at).epoch, 1)
    } finally { await first.close(); await second.close() }
    const reopened = await openSqliteInactiveMatterOwnerLeaseV1(f.database, migrations, { verify: async () => false })
    try { assert.equal(reopened.verifyCurrent('alpha.one', 'work', 1, later), true) }
    finally { await reopened.close() }
  } finally { await f.dispose() }
})

test('transfer requires evidence verifier and fences prior device with monotonic epoch', async () => {
  const f = await fixture()
  try {
    const denied = await openSqliteInactiveMatterOwnerLeaseV1(f.database, migrations, { verify: async () => false }, () => later)
    const allowed = await openSqliteInactiveMatterOwnerLeaseV1(f.database, migrations, { verify: async evidence => evidence.deviceId === 'one' && evidence.targetDeviceId === 'two' }, () => later)
    try {
      denied.claim('alpha.one', 'work', undefined, at)
      await assert.rejects(() => denied.transfer('alpha.two', 'work', transferInput, later), /not verified/)
      assert.throws(() => denied.claim('alpha.two', 'work', 1, later), /another device/)
      assert.equal((await allowed.transfer('alpha.two', 'work', transferInput, later)).epoch, 2)
      assert.equal(denied.verifyCurrent('alpha.one', 'work', 1, later), false)
      assert.throws(() => denied.claim('alpha.one', 'work', 1, later), /another device/)
      assert.equal(allowed.verifyCurrent('alpha.two', 'work', 2, later), true)
      const db = new DatabaseSync(f.database)
      try {
        const receipt = db.prepare('SELECT from_epoch,to_epoch,recovery_digest FROM cp_matter_owner_transfer').get() as Record<string, unknown>
        assert.deepEqual({ ...receipt }, { from_epoch: 1, to_epoch: 2, recovery_digest: digest })
        assert.equal(JSON.stringify(receipt).includes('message text'), false)
      } finally { db.close() }
    } finally { await denied.close(); await allowed.close() }
  } finally { await f.dispose() }
})

test('transfer rechecks owner after async verification and rejects superseded sessions', async () => {
  const f = await fixture()
  let continueVerification: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { continueVerification = resolve })
  let verificationStarted: (() => void) | undefined
  const started = new Promise<void>(resolve => { verificationStarted = resolve })
  try {
    const transfer = await openSqliteInactiveMatterOwnerLeaseV1(f.database, migrations, { verify: async () => { verificationStarted?.(); await waiting; return true } }, () => later)
    const other = await openSqliteInactiveMatterOwnerLeaseV1(f.database, migrations, { verify: async () => false }, () => later)
    try {
      transfer.claim('alpha.one', 'work', undefined, at)
      const pending = transfer.transfer('alpha.two', 'work', transferInput, later)
      await started
      other.claim('alpha.one', 'work', 1, later)
      continueVerification?.()
      await assert.rejects(() => pending, /source changed/)
      const db = new DatabaseSync(f.database)
      try { db.prepare(`UPDATE cp_device_session SET state='superseded' WHERE session_id=?`).run('alpha.one') }
      finally { db.close() }
      assert.throws(() => other.claim('alpha.one', 'work', 1, later), /session is unavailable/)
      assert.equal(other.verifyCurrent('alpha.two', 'work', 1, later), false)
    } finally { await transfer.close(); await other.close() }
  } finally { await f.dispose() }
})
