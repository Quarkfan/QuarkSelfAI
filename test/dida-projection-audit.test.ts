import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execute = promisify(execFile)

test('accepts only exact-schema projections with processed-message and shadow lineage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-dida-projection-audit-'))
  try {
    const dida = join(directory, 'dida')
    const run = join(dida, '1-12345678')
    await mkdir(run, { recursive: true })
    const messageId = 'om_synthetic_current_12345678'
    const result = {
      taskId: '', projectId: '', title: '【关注】合成只读样本', titlePrefix: '【关注】', urgencyLabel: '关注',
      keyItem: false, url: null, created: false, taskAction: 'ignored', intakeDecision: 'information',
      requestType: 'information', approvalRequired: false, approvalSummary: '', actionRequired: false,
      actionOwner: 'other', nextAction: '', notificationDecision: 'silent', notificationMode: 'silent',
      notificationDelayMinutes: 0, notificationTitle: '', ownerMessage: '', cardTone: 'grey', notificationReason: '无动作',
      materialChangeSummary: '', summary: '固定合成样本', priority: 0, tags: ['飞书', '关注'], dueDate: null,
      relationshipSummary: '无待办动作', needsClarification: false, clarificationQuestion: '', clarificationReason: '',
      blacklakeRelated: false, blacklakeDomains: [], recommendedSkills: [], skillDecisionReason: '',
      researchDecision: 'skip', researchChannel: 'none', researchDecisionReason: '无需调研', researchPrompt: '',
    }
    await writeFile(join(run, 'result.json'), JSON.stringify(result))
    const statePath = join(directory, 'state.json')
    await writeFile(statePath, JSON.stringify({
      mentionProcessedMessageIds: [messageId],
      shadowDecisions: [{ messageId, taskId: null, taskAction: 'ignored' }],
    }))
    const script = resolve('scripts/audit-dida-projections.mjs')
    const { stdout } = await execute(process.execPath, [script, dida, statePath, '--min-task-projections', '1', '--strict'], {
      cwd: resolve('.'),
    })
    const report = JSON.parse(stdout)
    assert.equal(report.exactSchemaAccepted, 1)
    assert.equal(report.legacySchemaSkipped, 0)
    assert.equal(report.externalWrites, 0)
    assert.equal(report.rawBusinessContentEmitted, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
