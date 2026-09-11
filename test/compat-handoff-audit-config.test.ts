import assert from 'node:assert/strict'
import test from 'node:test'
import {
  auditResourceHash, didaMaintenanceAuditConfig, followupAuditConfig,
  sessionLifecycleAuditConfig, xiaoweiResearchAuditConfig,
} from '../src/migration/compat-handoff-audit-config.js'

test('compat handoff audit maps resource scopes to exact durable owner grants', () => {
  const dida = didaMaintenanceAuditConfig({ didaProjectId: 'dida-project', didaCompletedRetentionDays: '45' })
  assert.equal(dida.cleanupAuthorization?.scope, 'dida.completed-task-cleanup')
  assert.equal(dida.cleanupAuthorization?.projectId, 'dida-project')
  assert.equal(dida.cleanupAuthorization?.revision, 1)
  assert.equal(dida.completedRetentionDays, 45)

  const followup = followupAuditConfig({ followupProjectId: 'followup-project' })
  assert.equal(followup.taskProjection?.authorization.scope, 'dida.task-projection')
  assert.equal(followup.taskProjection?.authorization.projectId, 'followup-project')
  assert.equal(followup.taskProjection?.authorization.revision, 1)

  const sessions = sessionLifecycleAuditConfig({ sessionDeleteAfterDays: '7' })
  assert.equal(sessions.authorization?.scope, 'codex.auto-research-session-lifecycle')
  assert.equal(sessions.authorization?.revision, 1)
  assert.equal(sessions.deleteAfterDays, 7)
})

test('compat handoff audit fails closed for missing resource identity', () => {
  assert.throws(() => didaMaintenanceAuditConfig({}), /didaProjectId/)
  assert.throws(() => followupAuditConfig({}), /followupProjectId/)
  assert.throws(() => xiaoweiResearchAuditConfig({ xiaoweiAgent: { openId: 'agent-only' } }), /Xiaowei identity/)
})

test('compat handoff audit emits stable bounded resource hashes', () => {
  const config = xiaoweiResearchAuditConfig({ xiaoweiAgent: { name: 'helper', openId: 'agent', chatId: 'chat' } })
  assert.equal(config.agentName, 'helper')
  assert.match(auditResourceHash(`${config.agentOpenId}:${config.agentChatId}`), /^[a-f0-9]{16}$/)
  assert.equal(auditResourceHash('same-resource'), auditResourceHash('same-resource'))
  assert.notEqual(auditResourceHash('same-resource'), auditResourceHash('other-resource'))
})
