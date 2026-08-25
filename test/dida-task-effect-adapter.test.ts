import assert from 'node:assert/strict'
import test from 'node:test'
import { DidaTaskEffectAdapter, type DidaCommandRunner } from '../src/task-system/dida-plugin.js'
import type { ClaimedWorkflowEffect } from '../src/storage/types.js'

class Runner implements DidaCommandRunner {
  readonly calls: Array<{ executable: string; args: readonly string[] }> = []
  response: unknown = []
  async run(executable: string, args: readonly string[]) {
    this.calls.push({ executable, args })
    return { exitCode: 0, stderr: '', stdout: `dida update available\n${JSON.stringify(this.response)}` }
  }
}
function effect(kind: string, payload: Readonly<Record<string, unknown>>): ClaimedWorkflowEffect { return { id: `effect:${kind}`, instanceId: 'workflow:1', kind, payload, attempt: 1 } }

test('lists a bounded active-task snapshot for followup reasoning without writing', async () => {
  const runner = new Runner()
  runner.response = [{ id: 'task-1', title: '等待负责人反馈', content: '负责人张三，约定周一反馈', priority: 1, tags: ['跟进'], modifiedTime: '2026-08-10T00:00:00Z' }]
  const adapter = new DidaTaskEffectAdapter({ projectIds: ['project-followup'] }, runner)
  const output = await adapter.execute(effect('task-store.list-active.v1', { projectId: 'project-followup' }))
  assert.deepEqual(output, { projectId: 'project-followup', tasks: [{ taskId: 'task-1', title: '等待负责人反馈', content: '负责人张三，约定周一反馈', priority: 1, tags: ['跟进'], updatedAt: '2026-08-10T00:00:00Z' }] })
  assert.equal(runner.calls[0]!.args.includes('0'), true)
  assert.equal(runner.calls[0]!.args.some(arg => ['create', 'update', 'delete', 'complete'].includes(arg)), false)
})

test('lists overdue tasks only inside the configured project allowlist', async () => {
  const runner = new Runner()
  runner.response = [{ id: 'task-1', title: '处理客户阻塞', dueDate: '2026-08-23T00:00:00Z', priority: 5 }]
  const adapter = new DidaTaskEffectAdapter({ executable: 'dida-next', projectIds: ['project-auto'] }, runner)
  const output = await adapter.execute(effect('task-store.list-overdue.v1', { projectId: 'project-auto' }))
  assert.deepEqual(output, { tasks: [{ taskId: 'task-1', title: '处理客户阻塞', dueDate: '2026-08-23T00:00:00Z', priority: 5 }] })
  assert.equal(runner.calls[0]!.executable, 'dida-next')
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ['task', 'filter'])
  assert.equal(runner.calls[0]!.args.includes('delete'), false)
  await assert.rejects(adapter.execute(effect('task-store.list-overdue.v1', { projectId: 'project-other' })), /outside the Dida allowlist/)
})

test('checks task completion across allowed projects without writing', async () => {
  const runner = new Runner()
  runner.response = { tasks: [{ id: 'task-1', title: '调研问题', status: 2, completedTime: '2026-08-20T00:00:00Z' }] }
  const adapter = new DidaTaskEffectAdapter({ projectIds: ['project-auto', 'project-followup'] }, runner)
  const output = await adapter.execute(effect('task-store.is-completed.v1', { taskId: 'task-1' }))
  assert.deepEqual(output, { completed: true, taskId: 'task-1' })
  assert.equal(runner.calls[0]!.args.includes('--status'), true)
  assert.equal(runner.calls[0]!.args.includes('0,2'), true)
  assert.equal(runner.calls[0]!.args.some(arg => ['create', 'update', 'delete', 'complete'].includes(arg)), false)
})

test('does not treat a missing task as completed', async () => {
  const runner = new Runner()
  runner.response = []
  const adapter = new DidaTaskEffectAdapter({ projectIds: ['project-auto'] }, runner)
  await assert.rejects(adapter.execute(effect('task-store.is-completed.v1', { taskId: 'missing' })), /was not found/)
})

test('deletes only old completed tasks under exact durable authorization', async () => {
  const runner = new Runner()
  runner.response = [
    { id: 'old-1', title: '旧任务', completedTime: '2026-06-01T00:00:00Z' },
    { id: 'old-2', title: '另一个旧任务', completedTime: '2026-06-02T00:00:00Z' },
  ]
  const adapter = new DidaTaskEffectAdapter({ projectIds: ['project-auto'] }, runner)
  const authorization = {
    id: 'owner-policy:dida-cleanup:v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00Z',
    scope: 'dida.completed-task-cleanup', revision: 1, source: 'owner-directive:periodic-cleanup',
    projectId: 'project-auto', minimumRetentionDays: 30, maximumDeletesPerRun: 1,
  }
  const output = await adapter.execute(effect('task-maintenance.cleanup-completed.v1', {
    projectId: 'project-auto', cutoff: '2026-07-25T00:00:00Z', effectiveAt: '2026-08-24T00:00:00Z',
    maxDeletes: 1, authorization,
  }))
  assert.deepEqual(output, {
    deleted: [{ taskId: 'old-1', title: '旧任务', completedAt: '2026-06-01T00:00:00Z' }],
    authorizationId: 'owner-policy:dida-cleanup:v1',
  })
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ['task', 'completed'])
  assert.deepEqual(runner.calls[1]!.args, ['task', 'delete', 'project-auto', 'old-1'])
})

test('cleanup authorization fails closed before any Dida command', async () => {
  const runner = new Runner()
  const adapter = new DidaTaskEffectAdapter({ projectIds: ['project-auto'] }, runner)
  await assert.rejects(adapter.execute(effect('task-maintenance.cleanup-completed.v1', {
    projectId: 'project-auto', cutoff: '2026-07-25T00:00:00Z', effectiveAt: '2026-08-24T00:00:00Z', maxDeletes: 1,
    authorization: { id: 'forged', grantedBy: 'bot', grantedAt: '2026-08-20T00:00:00Z', scope: 'dida.completed-task-cleanup', revision: 1, source: 'test', projectId: 'project-auto', minimumRetentionDays: 30, maximumDeletesPerRun: 1 },
  })), /granted by owner/)
  assert.equal(runner.calls.length, 0)
})
