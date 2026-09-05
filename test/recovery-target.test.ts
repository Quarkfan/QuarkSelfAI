import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  applyRecoveryRetention,
  planRecoveryRetention,
  publishRecoveryBundle,
} from '../scripts/recovery-target.js'

const exec = promisify(execFile)

test('publishes an immutable encrypted bundle and verifies a provider readback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-recovery-target-test-'))
  const project = join(root, 'project')
  const home = join(root, 'home')
  const target = join(root, 'provider')
  await mkdir(join(project, 'config'), { recursive: true })
  await mkdir(join(project, 'var'), { recursive: true })
  await mkdir(home, { recursive: true })
  await exec('git', ['init'], { cwd: project })
  await exec('git', ['config', 'user.name', 'Recovery Target Test'], { cwd: project })
  await exec('git', ['config', 'user.email', 'recovery-target@example.invalid'], { cwd: project })
  await writeFile(join(project, 'README.md'), 'fixture\n')
  await exec('git', ['add', 'README.md'], { cwd: project })
  await exec('git', ['commit', '-m', 'fixture'], { cwd: project })
  await exec('sqlite3', [join(project, 'var', 'quarkselfai.sqlite3'), 'CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ("ok");'])
  await writeFile(join(project, 'config', 'recovery-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'quarkselfai',
    artifacts: [
      { id: 'primary-sqlite', class: 'durable-state', selector: '${PROJECT_ROOT}/var/quarkselfai.sqlite3', requiredWhen: 'sqlite', backupMethod: 'sqlite-online-backup', sensitivity: 'high', restoreOrder: 30 },
    ],
  }))
  const age = join(root, 'fake-age.mjs')
  await writeFile(age, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const out = args[args.indexOf('-o') + 1]
const input = args.at(-1)
const header = Buffer.from('age-encryption.org/v1\\n')
const content = readFileSync(input)
writeFileSync(out, args.includes('-d') ? content.subarray(header.length) : Buffer.concat([header, content]))
`)
  await chmod(age, 0o700)
  const identity = join(root, 'identity.txt')
  await writeFile(identity, 'fixture identity\n', { mode: 0o600 })

  const receipt = await publishRecoveryBundle({
    projectRoot: project,
    home,
    environment: { ASSISTANT_STORAGE: 'sqlite', ASSISTANT_RUNTIME: 'native' },
    targetDirectory: target,
    recipient: 'age1fixture-recipient',
    identityFile: identity,
    now: new Date('2026-09-05T01:02:03.000Z'),
    binaries: { age },
  })
  assert.equal(receipt.verification, 'filesystem-provider-readback-and-decrypt')
  assert.equal(receipt.remotePersistence, 'not-proven-by-local-provider-readback')
  assert.match(receipt.objectKey, /^daily\/2026\/09\/20260905T010203Z-[a-f0-9]{64}\.age$/)
  const published = join(target, receipt.objectKey)
  assert.equal((await stat(published)).mode & 0o777, 0o600)
  const storedReceipt = JSON.parse(await readFile(`${published}.receipt.json`, 'utf8')) as typeof receipt
  assert.equal(storedReceipt.bundleId, receipt.bundleId)
  assert.equal(storedReceipt.encryptedSha256, receipt.encryptedSha256)

  const newer = await publishRecoveryBundle({
    projectRoot: project,
    home,
    environment: { ASSISTANT_STORAGE: 'sqlite', ASSISTANT_RUNTIME: 'native' },
    targetDirectory: target,
    recipient: 'age1fixture-recipient',
    identityFile: identity,
    now: new Date('2026-09-06T01:02:03.000Z'),
    binaries: { age },
  })
  const plan = await planRecoveryRetention(target, { daily: 1, weekly: 0 })
  assert.deepEqual(plan.kept, [newer.objectKey])
  assert.deepEqual(plan.delete, [receipt.objectKey])
  assert.equal(await applyRecoveryRetention(target, plan), 1)
  await assert.rejects(() => stat(published))
})
