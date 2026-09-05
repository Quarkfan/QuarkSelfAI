import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  auditAccountBootstrap,
  type AccountCommandRunner,
  type CommandResult,
} from '../scripts/audit-account-bootstrap.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'quark-accounts-'))
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'deploy', 'dsh-runtime'), { recursive: true })
  await writeFile(join(root, 'config', 'account-bootstrap.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'quarkselfai',
    accounts: [
      ['github', 'source-control'], ['codex', 'executor'], ['claude', 'executor'],
      ['lark-user', 'channel-identity'], ['lark-bot', 'channel-identity'], ['dida', 'task-system'],
      ['dsh-runtime', 'assistant-kernel'], ['dsh-inference', 'model-provider'],
    ].map(([id, accountClass]) => ({ id, class: accountClass, required: true, loginHint: `login ${id}` })),
  }))
  await writeFile(join(root, 'deploy', 'dsh-runtime', 'package.json'), JSON.stringify({
    dependencies: { '@deepseek-ai/dsh': '0.1.1-rc.2' },
  }))
  return root
}

class FakeRunner implements AccountCommandRunner {
  readonly calls: string[] = []
  constructor(private readonly failure?: string) {}
  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push([command, ...args].join(' '))
    if (this.failure === command) return { exitCode: 1, stdout: 'secret-token-value', stderr: 'private upstream response' }
    if (command === 'codex') return { exitCode: 0, stdout: 'Logged in using ChatGPT', stderr: '' }
    if (command === 'claude') return { exitCode: 0, stdout: '{"loggedIn":true,"email":"private@example.invalid"}', stderr: '' }
    if (command === 'lark-cli') return { exitCode: 0, stdout: 'upgrade banner\n{"identities":{"user":{"available":true,"status":"ready","openId":"secret"},"bot":{"available":true,"status":"ready"}},"scope":"secret scopes"}', stderr: '' }
    if (command === 'dida') return { exitCode: 0, stdout: 'Token: secret-token-value', stderr: '' }
    if (command === 'git') return { exitCode: 0, stdout: 'private remote ref', stderr: '' }
    return { exitCode: null, stdout: '', stderr: '', unavailable: true }
  }
}

test('reports only bounded account states while discarding command output and identifiers', async () => {
  const root = await fixture()
  const runner = new FakeRunner()
  const report = await auditAccountBootstrap({
    projectRoot: root,
    environment: { QUARK_INFERENCE_BASE_URL: 'https://private.invalid', QUARK_INFERENCE_API_KEY: 'secret' },
    online: true,
    runner,
  })
  assert.equal(report.ok, true)
  assert.equal(report.checks.length, 8)
  assert.equal(runner.calls.filter(call => call.startsWith('lark-cli ')).length, 1)
  assert.ok(runner.calls.includes('dida project list'))
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /secret-token-value|private@example|openId|secret scopes|private remote ref/)
  assert.deepEqual(report.privacy, {
    commandOutputIncluded: false,
    credentialValuesIncluded: false,
    personalIdentifiersIncluded: false,
  })
})

test('keeps offline network checks unverified and classifies a failed login without leaking details', async () => {
  const root = await fixture()
  const report = await auditAccountBootstrap({
    projectRoot: root,
    environment: {},
    runner: new FakeRunner('claude'),
  })
  assert.equal(report.ok, false)
  assert.ok(report.blockers.includes('github:online-read-check-not-requested'))
  assert.ok(report.blockers.includes('claude:authentication-not-ready'))
  assert.ok(report.blockers.includes('dsh-inference:provider-secret-or-endpoint-missing'))
  assert.doesNotMatch(JSON.stringify(report), /private upstream response|secret-token-value/)
})
