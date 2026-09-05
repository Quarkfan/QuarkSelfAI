import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { createRecoveryBundle, prepareRestoreSafe, stageRecoveryBundle } from '../scripts/recovery-bundle.js'
import { loadRuntimeConfig } from '../src/config/runtime.js'

const exec = promisify(execFile)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'quark-recovery-test-'))
  const project = join(root, 'project')
  const home = join(root, 'home')
  await mkdir(join(project, 'config'), { recursive: true })
  await mkdir(join(project, 'var', 'dsh'), { recursive: true })
  await mkdir(join(project, 'var', 'handoff'), { recursive: true })
  await mkdir(join(project, 'var', 'capability-evolution'), { recursive: true })
  await mkdir(join(home, '.lark-cli'), { recursive: true })
  await mkdir(join(home, '.config', 'dida-cli'), { recursive: true })
  await exec('git', ['init'], { cwd: project })
  await exec('git', ['config', 'user.name', 'Recovery Test'], { cwd: project })
  await exec('git', ['config', 'user.email', 'recovery@example.invalid'], { cwd: project })
  await writeFile(join(project, 'README.md'), 'fixture\n')
  await exec('git', ['add', 'README.md'], { cwd: project })
  await exec('git', ['commit', '-m', 'fixture'], { cwd: project })
  const freshClone = join(root, 'fresh-clone')
  await exec('git', ['clone', project, freshClone])
  await exec('sqlite3', [join(project, 'var', 'quarkselfai.sqlite3'), 'CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ("ok");'])
  await exec('sqlite3', [join(project, 'var', 'dsh', 'quarkselfai.sqlite3'), 'CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ("dsh");'])
  await writeFile(join(project, 'var', 'dsh', 'settings.yaml'), 'profile: fixture\n')
  await writeFile(join(project, 'var', 'dsh', 'ignored.log'), 'ignore me\n')
  await mkdir(join(project, 'var', 'dsh', 'node_modules'), { recursive: true })
  await writeFile(join(project, 'var', 'dsh', 'node_modules', 'generated.js'), 'do not preserve\n')
  await writeFile(join(project, 'var', 'handoff', 'state.json'), '{"state":"fixture"}\n')
  await writeFile(join(project, 'var', 'handoff', 'config.json'), '{"config":"fixture"}\n')
  await writeFile(join(project, 'var', 'runtime.env'), 'ASSISTANT_STORAGE=sqlite\n')
  await chmod(join(project, 'var', 'runtime.env'), 0o644)
  await writeFile(join(project, 'var', 'capability-evolution', 'status.json'), '{"status":"fixture"}\n')
  await writeFile(join(home, '.lark-cli', 'config.json'), '{"token":"fixture"}\n')
  await writeFile(join(home, '.config', 'dida-cli', 'config.json'), '{"token":"fixture"}\n')
  await writeFile(join(project, 'config', 'recovery-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'quarkselfai',
    artifacts: [
      { id: 'primary-sqlite', class: 'durable-state', selector: '${PROJECT_ROOT}/var/quarkselfai.sqlite3', requiredWhen: 'sqlite', backupMethod: 'sqlite-online-backup', sensitivity: 'high', restoreOrder: 30 },
      { id: 'dsh-production-profile', class: 'durable-state', selector: '${PROJECT_ROOT}/var/dsh', requiredWhen: 'always', backupMethod: 'filtered-archive', sensitivity: 'high', restoreOrder: 40 },
      { id: 'runtime-environment', class: 'secret-config', selector: '${PROJECT_ROOT}/var/runtime.env', requiredWhen: 'always', backupMethod: 'encrypted-file', sensitivity: 'critical', restoreOrder: 20 },
      { id: 'compatibility-config', class: 'secret-config', selector: '${ENV:COMPAT_CONFIG_PATH}', selectorKind: 'environment', requiredWhen: 'compatibility', backupMethod: 'encrypted-file', sensitivity: 'critical', restoreOrder: 25 },
      { id: 'compatibility-state', class: 'durable-state', selector: '${PROJECT_ROOT}/var/handoff', requiredWhen: 'compatibility', backupMethod: 'filtered-archive', sensitivity: 'high', restoreOrder: 35 },
      { id: 'capability-evolution-state', class: 'durable-state', selector: '${PROJECT_ROOT}/var/capability-evolution', requiredWhen: 'always', backupMethod: 'filtered-archive', sensitivity: 'medium', restoreOrder: 50 },
      { id: 'lark-cli-profile', class: 'account-bootstrap', selector: '${HOME}/.lark-cli/config.json', requiredWhen: 'always', backupMethod: 'encrypted-file-or-reauthenticate', sensitivity: 'critical', restoreOrder: 10 },
      { id: 'dida-cli-profile', class: 'account-bootstrap', selector: '${HOME}/.config/dida-cli/config.json', requiredWhen: 'always', backupMethod: 'encrypted-file-or-reauthenticate', sensitivity: 'critical', restoreOrder: 10 },
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
  return { root, project, home, age, identity, freshClone }
}

test('creates an encrypted-only recovery artifact and stages a verified restore', async () => {
  const context = await fixture()
  const output = join(context.root, 'recovery.age')
  const document = await createRecoveryBundle({
    projectRoot: context.project,
    home: context.home,
    environment: {
      ASSISTANT_STORAGE: 'sqlite',
      ASSISTANT_RUNTIME: 'compatibility',
      COMPAT_CONFIG_PATH: join(context.project, 'var', 'handoff', 'config.json'),
    },
    output,
    recipient: 'age1fixture-recipient',
    binaries: { age: context.age },
  })
  assert.equal(document.captureMode, 'online-bounded')
  assert.ok(document.entries.some(entry => entry.path === 'artifacts/primary-sqlite/database.sqlite3'))
  assert.equal(document.entries.some(entry => entry.path.endsWith('ignored.log')), false)
  assert.equal(document.entries.some(entry => entry.path.includes('/node_modules/')), false)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  assert.match((await readFile(output)).subarray(0, 22).toString('utf8'), /^age-encryption\.org\/v1/)

  const staged = join(context.root, 'staged')
  const restored = await stageRecoveryBundle({
    input: output,
    outputDirectory: staged,
    identityFile: context.identity,
    binaries: { age: context.age },
  })
  assert.equal(restored.bundleId, document.bundleId)
  const result = await exec('sqlite3', ['-readonly', join(staged, 'artifacts', 'primary-sqlite', 'database.sqlite3'), 'SELECT value FROM proof;'])
  assert.equal(result.stdout.trim(), 'ok')
  assert.equal((await stat(join(staged, 'artifacts', 'runtime-environment', 'runtime.env'))).mode & 0o777, 0o600)
  assert.match(await readFile(join(staged, 'artifacts', 'compatibility-state', 'state.json'), 'utf8'), /fixture/)

  const receipt = await prepareRestoreSafe({
    stagingDirectory: staged,
    projectRoot: context.freshClone,
    webPort: 14321,
  })
  assert.equal(receipt.mode, 'restore-safe')
  assert.ok(receipt.pendingGates.includes('owner-approved-single-writer-takeover'))
  const safeEnvironment = await readFile(join(context.freshClone, 'var', 'restore-safe.env'), 'utf8')
  assert.match(safeEnvironment, /ASSISTANT_RUNTIME=control-only/)
  assert.match(safeEnvironment, /ASSISTANT_KERNEL=off/)
  assert.match(safeEnvironment, /TAKEOVER_CONFIRMED=false/)
  assert.doesNotMatch(safeEnvironment, /COMPAT_CONFIG_PATH=/)
  const safeEnv = Object.fromEntries(safeEnvironment.split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  const safeConfig = loadRuntimeConfig(safeEnv, context.freshClone)
  assert.equal(safeConfig.runtime.mode, 'control-only')
  assert.equal(safeConfig.kernel.mode, 'off')
  assert.equal(safeConfig.web.host, '127.0.0.1')
  const restoredResult = await exec('sqlite3', ['-readonly', join(context.freshClone, 'var', 'quarkselfai.sqlite3'), 'SELECT value FROM proof;'])
  assert.equal(restoredResult.stdout.trim(), 'ok')
  assert.equal((await stat(join(context.freshClone, 'var', 'restore-safe.env'))).mode & 0o777, 0o600)
  await assert.rejects(() => prepareRestoreSafe({
    stagingDirectory: staged,
    projectRoot: context.freshClone,
  }), /var directory already exists/)
})

test('refuses plaintext output and an invalid encryption recipient', async () => {
  const context = await fixture()
  await assert.rejects(() => createRecoveryBundle({
    projectRoot: context.project,
    home: context.home,
    environment: {},
    output: join(context.root, 'recovery.tar.gz'),
    recipient: 'age1fixture-recipient',
  }), /must end with \.age/)
  await assert.rejects(() => createRecoveryBundle({
    projectRoot: context.project,
    home: context.home,
    environment: {},
    output: join(context.root, 'recovery.age'),
    recipient: 'plaintext-password',
  }), /public recipient/)
})
