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

test('lists overdue tasks only inside the configured project allowlist', async () => {
  const runner = new Runner()
  runner.response = [{ id: 'task-1', title: '处理客户阻塞', dueDate: '2026-08-23T00:00:00Z', priority: 5 }]
  const adapter = new DidaTaskEffectAdapter({ executable: 'dida-next', projectIds: ['project-auto'] }, runner)
  const output = await adapter.execute(effect('task-system.list-overdue.v1', { projectId: 'project-auto' }))
  assert.deepEqual(output, { tasks: [{ taskId: 'task-1', title: '处理客户阻塞', dueDate: '2026-08-23T00:00:00Z', priority: 5 }] })
  assert.equal(runner.calls[0]!.executable, 'dida-next')
  assert.deepEqual(runner.calls[0]!.args.slice(0, 2), ['task', 'filter'])
  assert.equal(runner.calls[0]!.args.includes('delete'), false)
  await assert.rejects(adapter.execute(effect('task-system.list-overdue.v1', { projectId: 'project-other' })), /outside the Dida allowlist/)
})

test('checks task completion across allowed projects without writing', async () => {
  const runner = new Runner()
  runner.response = { tasks: [{ id: 'task-1', title: '调研问题', status: 2, completedTime: '2026-08-20T00:00:00Z' }] }
  const adapter = new DidaTaskEffectAdapter({ projectIds: ['project-auto', 'project-followup'] }, runner)
  const output = await adapter.execute(effect('task-system.is-completed.v1', { taskId: 'task-1' }))
  assert.deepEqual(output, { completed: true, taskId: 'task-1' })
  assert.equal(runner.calls[0]!.args.includes('--status'), true)
  assert.equal(runner.calls[0]!.args.includes('0,2'), true)
  assert.equal(runner.calls[0]!.args.some(arg => ['create', 'update', 'delete', 'complete'].includes(arg)), false)
})

test('does not treat a missing task as completed', async () => {
  const runner = new Runner()
  runner.response = []
  const adapter = new DidaTaskEffectAdapter({ projectIds: ['project-auto'] }, runner)
  await assert.rejects(adapter.execute(effect('task-system.is-completed.v1', { taskId: 'missing' })), /was not found/)
})
