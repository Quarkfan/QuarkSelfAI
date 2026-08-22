import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MentionMonitor } from '../packages/bridge-compat/src/mention-monitor.js'
import { StateStore } from '../packages/bridge-compat/src/state-store.js'

const directory = await mkdtemp(path.join(os.tmpdir(), 'quark-notification-recovery-'))
const config = {
  mentionInitialLookbackMinutes: 30,
  mentionOverlapMinutes: 2,
  mentionContextMinutes: 30,
  allowedOpenId: 'ou_synthetic_owner',
  notificationTimeZone: 'Asia/Shanghai',
  specialAttentionUsers: [],
}
const emptySearches = {
  async searchSpecialAttentionMessages() { return [] },
  async searchDirectMessages() { return [] },
  async searchFlaggedConversationMessages() { return [] },
}
const logger = { error() {} }
try {
  const failedState = new StateStore(directory)
  await failedState.load()
  const failing = new MentionMonitor({
    config,
    state: failedState,
    lark: {
      ...emptySearches,
      async searchMentions() { throw new Error('synthetic connection timeout') },
      async send() { throw new Error('synthetic Feishu connection unavailable') },
    },
    taskCreator: {},
    logger,
  })
  await failing.poll()
  const persistedFailureAt = failedState.state.mentionHealthFailure?.at
  if (!persistedFailureAt || failedState.state.mentionHealthFailure?.notifiedAt) {
    throw new Error('failure was not persisted as an undelivered notification')
  }

  const recoveredState = new StateStore(directory)
  await recoveredState.load()
  const delivered = []
  const recovered = new MentionMonitor({
    config,
    state: recoveredState,
    lark: {
      ...emptySearches,
      async searchMentions() { return [] },
      async send(message, key) { delivered.push({ message, key }) },
    },
    taskCreator: {},
    logger,
  })
  await recovered.poll()
  await recovered.poll()
  const notification = delivered[0]
  if (delivered.length !== 1 || !notification?.message.includes('曾发生异常，现已恢复') ||
      !notification.message.includes('北京时间') || notification.message.includes('T12:')) {
    throw new Error('recovery notification did not satisfy persistence, deduplication, or timezone requirements')
  }
  if (recoveredState.state.mentionHealthFailure !== null) throw new Error('health state was not cleared after recovery')
  process.stdout.write(`${JSON.stringify({
    ok: true,
    persistedAcrossRestart: true,
    failureNotificationInitiallyUndeliverable: true,
    recoveryNotificationCount: delivered.length,
    deduplicatedAfterSecondHealthyPoll: true,
    beijingTimeRendered: true,
    finalHealth: 'healthy',
    connector: 'isolated',
    externalWrites: 0,
  }, null, 2)}\n`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
