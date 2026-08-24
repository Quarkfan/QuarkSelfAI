import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { DurableEventRuntime } from '../src/events/runtime.js'
import * as intakePlugin from '../src/intake/plugin.js'
import { DurableStateService } from '../src/storage/service.js'
import { DurableWorkflowRuntime } from '../src/workflow/runtime.js'

test('intake cheaply selects owner DM, focus people, owner cards, membership and owner reactions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-intake-plugin-'))
  const ctx = new Context()
  try {
    await ctx.plugin(DurableStateService, { sqlitePath: join(directory, 'state.sqlite3') })
    await ctx.plugin(DurableWorkflowRuntime, { workerId: 'workflow', enabled: false })
    await ctx.plugin(DurableEventRuntime, { workerId: 'events', enabled: false })
    await ctx.plugin(intakePlugin, { enabled: true, ownerOpenId: 'owner', workspace: '/workspace', focusSenderIds: ['focus'], delegationInviterId: 'delegate', taskProjection: { projectId: 'automation', authorization: { id: 'task-projection-v1', grantedBy: 'owner', grantedAt: '2026-08-20T00:00:00+08:00', scope: 'dida.task-projection', revision: 1, source: 'owner-directive', projectId: 'automation' } } })
    const base = { source: { channel: 'feishu' as const }, occurredAt: '2026-08-24T00:00:00Z', raw: {} }
    await ctx.quarkIntake.handle({ ...base, kind: 'message.received', eventKey: 'im.message.receive_v1', deduplicationKey: 'dm', source: { ...base.source, senderId: 'owner' }, payload: { chatType: 'p2p', content: '自然语言目标' } })
    await ctx.quarkIntake.handle({ ...base, kind: 'message.received', eventKey: 'im.message.receive_v1', deduplicationKey: 'focus', source: { ...base.source, senderId: 'focus' }, payload: { chatType: 'group', content: '更新' } })
    await ctx.quarkIntake.handle({ ...base, kind: 'message.received', eventKey: 'im.message.receive_v1', deduplicationKey: 'other-dm', source: { ...base.source, senderId: 'colleague' }, payload: { chatType: 'p2p', content: '请审批' } })
    await ctx.quarkIntake.handle({ ...base, kind: 'message.received', eventKey: 'im.message.receive_v1', deduplicationKey: 'noise', source: { ...base.source, senderId: 'noise' }, payload: { chatType: 'group', content: '闲聊' } })
    await ctx.quarkIntake.handle({ ...base, kind: 'card.action', eventKey: 'card.action.trigger', deduplicationKey: 'card', payload: { operatorId: 'owner' } })
    await ctx.quarkIntake.handle({ ...base, kind: 'channel.event', eventKey: 'im.chat.member.user.added_v1', deduplicationKey: 'member', payload: { event: { operator_id: { open_id: 'delegate' }, users: [{ user_id: { open_id: 'owner' } }] } } })
    await ctx.quarkIntake.handle({ ...base, kind: 'channel.event', eventKey: 'im.message.reaction.created_v1', deduplicationKey: 'reaction', payload: { event: { user_id: { open_id: 'owner' } } } })
    assert.equal(await ctx.quarkState.workflow(`message-intake:${hash('noise')}`), undefined)
    const workflows = await ctx.quarkState.dueWorkflows('2099-01-01T00:00:00Z', 20)
    assert.equal(workflows.length, 0)
    for (const key of ['dm', 'focus', 'other-dm', 'card', 'member', 'reaction']) {
      const id = `message-intake:${hash(key)}`
      assert.ok(await ctx.quarkState.workflow(id), key)
    }
  } finally {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

function hash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 32) }
