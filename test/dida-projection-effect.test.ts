import assert from 'node:assert/strict'
import test from 'node:test'
import { DidaProjectionEffectAdapter, type ProjectionCommandRunner } from '../src/task-system/projection-plugin.js'
import { TASK_PROJECTION_EFFECTS } from '../src/task-system/projection-effects.js'
import type { ClaimedWorkflowEffect } from '../src/storage/types.js'

class FakeDida implements ProjectionCommandRunner {
  readonly calls: readonly string[][] = [] as string[][]
  readonly tasks = new Map<string, Record<string, unknown>>()
  async run(_executable: string, args: readonly string[]) {
    ;(this.calls as string[][]).push([...args])
    const command = args[1]
    if (command === 'search') {
      const marker = args[2]!
      return ok({ tasks: [...this.tasks.values()].filter(task => String(task.content ?? '').includes(marker)) })
    }
    if (command === 'get') {
      const task = this.tasks.get(args[3]!)
      return task ? ok(task) : { exitCode: 1, stdout: '', stderr: 'not found' }
    }
    if (command === 'create') {
      const task = fromArgs(args, `task-${this.tasks.size + 1}`)
      this.tasks.set(String(task.id), task)
      return ok(task)
    }
    if (command === 'update') {
      const id = args[2]!
      const previous = this.tasks.get(id) ?? { id, projectId: value(args, '--project'), kind: 'TEXT' }
      const task = { ...previous, ...fromArgs(args, id) }
      this.tasks.set(id, task)
      return ok(task)
    }
    return { exitCode: 1, stdout: '', stderr: `unsupported ${args.join(' ')}` }
  }
}

test('creates one ordinary glanceable task with durable Feishu lineage and authorization', async () => {
  const runner = new FakeDida()
  const adapter = new DidaProjectionEffectAdapter({ projectIds: ['automation'] }, runner)
  const output = await adapter.execute(intakeEffect())
  const result = output.result as Record<string, unknown>
  assert.equal(result.action, 'created')
  const task = runner.tasks.get(String(result.taskId))!
  assert.equal(task.kind, 'TEXT')
  assert.match(String(task.title), /^【紧急·关键】/)
  assert.deepEqual(task.tags, ['飞书', '紧急', '待批准', '关键事项', '客户'])
  assert.match(String(task.content), /^## 当前摘要/)
  assert.match(String(task.content), /\[feishu:om-1\]/)
  assert.equal(runner.calls.filter(call => call[1] === 'create').length, 1)
})

test('retries resolve the same marker without another create or progress append', async () => {
  const runner = new FakeDida()
  const adapter = new DidaProjectionEffectAdapter({ projectIds: ['automation'] }, runner)
  const first = await adapter.execute(intakeEffect())
  const second = await adapter.execute(intakeEffect())
  assert.equal((second.result as Record<string, unknown>).action, 'unchanged')
  assert.equal(runner.calls.filter(call => call[1] === 'create').length, 1)
  const task = runner.tasks.get(String((first.result as Record<string, unknown>).taskId))!
  assert.equal(String(task.content).match(/\[feishu:om-1\]/g)?.length, 1)
})

test('fails closed for missing authorization and an existing NOTE lineage', async () => {
  const runner = new FakeDida()
  const adapter = new DidaProjectionEffectAdapter({ projectIds: ['automation'] }, runner)
  const noAuthorization = { ...intakeEffect(), payload: { ...intakeEffect().payload, authorization: undefined } }
  await assert.rejects(adapter.execute(noAuthorization), /authorization evidence/)
  assert.equal(runner.calls.length, 0)
  runner.tasks.set('note-1', { id: 'note-1', projectId: 'automation', kind: 'NOTE', title: '旧错误项', content: '[feishu:om-1]' })
  await assert.rejects(adapter.execute(intakeEffect()), /NOTE/)
  assert.equal(runner.calls.some(call => call[1] === 'create' || call[1] === 'update'), false)
})

test('rewrites the quick summary and appends a followup reply only once', async () => {
  const runner = new FakeDida()
  runner.tasks.set('follow-1', { id: 'follow-1', projectId: 'followup', kind: 'TEXT', title: '等待张三反馈', content: '## 当前摘要\n旧状态\n\n## 进展记录', priority: 1, tags: ['跟进'] })
  const adapter = new DidaProjectionEffectAdapter({ projectIds: ['followup'] }, runner)
  const effect = projectionEffect(TASK_PROJECTION_EFFECTS.recordFollowupReply, 'followup', {
    taskId: 'follow-1', idempotencyKey: 'reply:om-2', contact: { name: '张三' }, replyContent: '今天已经完成',
  })
  const first = await adapter.execute(effect)
  const second = await adapter.execute(effect)
  assert.equal((first.result as Record<string, unknown>).action, 'updated')
  assert.equal((second.result as Record<string, unknown>).action, 'unchanged')
  const content = String(runner.tasks.get('follow-1')?.content)
  assert.match(content, /^## 当前摘要\n张三回复：今天已经完成/)
  assert.equal(content.match(/\[projection:reply:om-2\]/g)?.length, 1)
})

test('applies a reviewed followup patch before it can be reported as maintained', async () => {
  const runner = new FakeDida()
  runner.tasks.set('follow-2', { id: 'follow-2', projectId: 'followup', kind: 'TEXT', title: '等待反馈', content: '## 当前摘要\n等待中\n\n## 进展记录', priority: 1, tags: ['跟进'] })
  const adapter = new DidaProjectionEffectAdapter({ projectIds: ['followup'] }, runner)
  const effect = projectionEffect(TASK_PROJECTION_EFFECTS.applyFollowupUpdate, 'followup', { idempotencyKey: 'review:2026-08-24:follow-2', update: { taskId: 'follow-2', title: '确认张三反馈进度', summary: '约定日期已到，尚未收到反馈。', changes: ['更新下一步'], reason: '等待期已过', priority: 3, tags: ['重要', '待跟进'] } })
  const first = await adapter.execute(effect)
  const second = await adapter.execute(effect)
  assert.equal((first.result as Record<string, unknown>).action, 'updated')
  assert.equal((second.result as Record<string, unknown>).action, 'unchanged')
  const task = runner.tasks.get('follow-2')!
  assert.equal(task.title, '确认张三反馈进度')
  assert.equal(task.priority, 3)
  assert.match(String(task.content), /\[projection:review:2026-08-24:follow-2\]/)
})

function intakeEffect(): ClaimedWorkflowEffect {
  return projectionEffect(TASK_PROJECTION_EFFECTS.upsertIntake, 'automation', {
    sourceEvent: { deduplicationKey: 'om-1', occurredAt: '2026-08-24T09:00:00Z', source: { messageId: 'om-1', conversationId: 'oc-1' }, payload: { content: '确认客户配额' } },
    decision: { outcome: 'task', summary: '客户调用量即将超限，需要批准是否增加配额。', materialChange: true, notifyOwner: true, approvalRequired: true, title: '确认客户 API 配额', priority: 5, tags: ['关键事项', '客户'] },
  })
}
function projectionEffect(kind: string, projectId: string, payload: Readonly<Record<string, unknown>>): ClaimedWorkflowEffect {
  return { id: `effect:${kind}`, instanceId: 'workflow:1', kind, attempt: 1, payload: { ...payload, projectId, effectiveAt: '2026-08-24T09:00:00Z', authorization: { id: 'owner-task-projection-v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00+08:00', scope: 'dida.task-projection', revision: 1, source: 'owner-directive:auto-task-management', projectId } } }
}
function fromArgs(args: readonly string[], id: string): Record<string, unknown> {
  return { id, projectId: value(args, '--project'), kind: 'TEXT', title: value(args, '--title') ?? '等待张三反馈', content: value(args, '--content') ?? '', priority: Number(value(args, '--priority') ?? 1), tags: String(value(args, '--tags') ?? '跟进').split(','), dueDate: value(args, '--due-date') }
}
function value(args: readonly string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
function ok(value: unknown) { return { exitCode: 0, stdout: JSON.stringify(value), stderr: '' } }
