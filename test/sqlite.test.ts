import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSqliteStore } from '../src/storage/sqlite.js'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))

test('SQLite is a zero-configuration durable default with event idempotency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-sqlite-'))
  const database = join(directory, 'assistant.sqlite3')
  const store = await createSqliteStore(database, migrations)
  try {
    await store.migrate()
    await store.migrate()
    const event = {
      kind: 'message.received' as const,
      source: { channel: 'feishu' as const, messageId: 'om-sqlite' },
      eventKey: 'im.message.receive_v1',
      deduplicationKey: 'om-sqlite',
      payload: { content: 'hello' },
      raw: { message_id: 'om-sqlite' },
    }
    assert.deepEqual(await store.appendEvent('row-1', event), { id: 'row-1', inserted: true })
    assert.deepEqual(await store.appendEvent('row-2', event), { id: 'row-1', inserted: false })
    assert.equal((await store.overview()).events, 1)
    assert.equal((await store.recentEvents(10))[0]?.kind, 'message.received')
    assert.equal((await store.recentEvents(10))[0]?.deduplicationKey, 'om-sqlite')
    assert.deepEqual(await store.recentEventPayloads('message.received', 10), [{
      id: 'row-1', source: event.source, payload: event.payload,
    }])
    assert.deepEqual(await store.recentEventPayloads('card.action', 10), [])
    const signal = {
      id: 'signal-1', kind: 'collaboration.observation.v1', occurredAt: '2026-08-22T09:00:00.000Z',
      scope: { chatId: 'oc-one' }, data: { difference: 'could_batch' },
    }
    assert.deepEqual(await store.appendSignal(signal), { inserted: true })
    assert.deepEqual(await store.appendSignal(signal), { inserted: false })
    assert.equal((await store.recentSignals(signal.kind, 10))[0]?.data.difference, 'could_batch')
    await store.writeFeatureCheckpoint('collaboration-learning', 'evaluation', { lastEvaluatedAt: signal.occurredAt })
    assert.equal((await store.readFeatureCheckpoint('collaboration-learning', 'evaluation'))?.lastEvaluatedAt, signal.occurredAt)
    await assert.rejects(store.appendSignal({ ...signal, data: { difference: 'possible_miss' } }), /different durable content/)
    const revision = await store.savePolicyDraft({
      id: 'policy-1',
      name: '普通消息进入汇总',
      sourceText: '没有明确提到我的群消息放到汇总里',
      document: {
        version: 1,
        name: '普通消息进入汇总',
        description: '降低普通群消息干扰',
        priority: 100,
        when: { fact: 'message.mentionsOwner', op: 'eq', value: false },
        effect: { attention: 'batch' },
      },
      simulation: {
        sampleCount: 10,
        matchedCount: 6,
        silentCount: 0,
        batchCount: 6,
        realtimeCount: 0,
        urgentSuppressedCount: 0,
        coverageSufficient: true,
        safeToActivate: true,
        matchedSampleIds: ['sample-1'],
      },
    })
    assert.equal(revision, 1)
    const duplicateRevision = await store.savePolicyDraft({
      id: 'policy-1',
      name: '普通消息进入汇总',
      sourceText: '没有明确提到我的群消息放到汇总里',
      document: {
        version: 1,
        name: '普通消息进入汇总',
        description: '降低普通群消息干扰',
        priority: 100,
        when: { fact: 'message.mentionsOwner', op: 'eq', value: false },
        effect: { attention: 'batch' },
      },
      simulation: {
        sampleCount: 10, matchedCount: 6, silentCount: 0, batchCount: 6,
        realtimeCount: 0, urgentSuppressedCount: 0, coverageSufficient: true,
        safeToActivate: true, matchedSampleIds: ['sample-1'],
      },
    })
    assert.equal(duplicateRevision, 1)
    await store.activatePolicy('policy-1', revision, '2026-08-22T10:00:00.000Z')
    const storedPolicy = (await store.policies(10))[0]
    assert.equal(storedPolicy?.status, 'enabled')
    assert.equal(storedPolicy?.sourceText, '没有明确提到我的群消息放到汇总里')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('SQLite durable action claims survive expiry and reject stale workers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-action-ledger-'))
  const database = join(directory, 'assistant.sqlite3')
  const store = await createSqliteStore(database, migrations)
  try {
    await store.migrate()
    const input = {
      actionId: 'action-read',
      matterId: 'matter-read',
      matterTitle: 'Read local fixture',
      matterSummary: 'Read-only local action',
      intent: 'inspect a local fixture',
      source: { channel: 'feishu' as const, messageId: 'om-read' },
      request: {
        title: 'Read local fixture',
        prompt: 'read the fixture',
        workspace: directory,
        mode: 'read-only' as const,
      },
    }
    assert.deepEqual(await store.enqueueAction(input), { inserted: true })
    assert.deepEqual(await store.enqueueAction({
      ...input,
      request: {
        mode: 'read-only' as const,
        workspace: directory,
        prompt: 'read the fixture',
        title: 'Read local fixture',
      },
    }), { inserted: false })
    const first = await store.claimNextAction('worker-one', directory, '2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z')
    assert.equal(first?.attempt, 1)
    assert.equal(first?.approvalGranted, false)
    assert.equal(await store.claimNextAction('worker-two', directory, '2099-01-01T00:30:00.000Z', '2099-01-01T01:30:00.000Z'), undefined)
    const recovered = await store.claimNextAction('worker-two', directory, '2099-01-01T02:00:00.000Z', '2099-01-01T03:00:00.000Z')
    assert.equal(recovered?.attempt, 2)
    await assert.rejects(store.settleAction('action-read', 'worker-one', {
      actionId: 'action-read', executor: 'claude-code', status: 'completed', summary: 'stale',
    }), /does not own/)
    await store.settleAction('action-read', 'worker-two', {
      actionId: 'action-read', executor: 'claude-code', status: 'completed', summary: 'done',
    })
    assert.equal((await store.recentActions(10))[0]?.state, 'completed')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('SQLite does not claim a write action until its exact approval is durable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-action-approval-'))
  const database = join(directory, 'assistant.sqlite3')
  const store = await createSqliteStore(database, migrations)
  try {
    await store.migrate()
    await assert.rejects(store.enqueueAction({
      actionId: 'action-unsafe', matterId: 'matter-unsafe', matterTitle: 'Unsafe', matterSummary: '', intent: 'write',
      source: { channel: 'feishu' },
      request: { title: 'Unsafe', prompt: 'write', workspace: directory, mode: 'workspace-write' },
    }), /requires an approval/)
    await store.enqueueAction({
      actionId: 'action-write',
      matterId: 'matter-write',
      matterTitle: 'Approved local write',
      matterSummary: 'Waiting for owner',
      intent: 'write an approved local fixture',
      source: { channel: 'feishu', messageId: 'om-write' },
      request: { title: 'Approved local write', prompt: 'write the fixture', workspace: directory, mode: 'workspace-write' },
      approval: { id: 'approval-write', prompt: 'Allow this exact fixture write?' },
    })
    assert.equal(await store.claimNextAction('worker', directory, '2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z'), undefined)
    await store.decideApproval('approval-write', 'approved', { actor: 'owner', revision: 1 }, '2099-01-01T00:01:00.000Z')
    await store.decideApproval('approval-write', 'approved', { actor: 'owner', revision: 1 }, '2099-01-01T00:01:00.000Z')
    const claimed = await store.claimNextAction('worker', directory, '2099-01-01T00:02:00.000Z', '2099-01-01T01:02:00.000Z')
    assert.equal(claimed?.approvalGranted, true)
    assert.equal(claimed?.request.mode, 'workspace-write')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('SQLite also honors an explicit approval gate on read-only research', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-read-approval-'))
  const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
  try {
    await store.migrate()
    await store.enqueueAction({
      actionId: 'action-confirmed-research', matterId: 'matter-confirmed-research',
      matterTitle: 'Confirmed research', matterSummary: 'Wait for the owner', intent: 'research',
      source: { channel: 'feishu', messageId: 'om-confirmed-research' },
      request: { title: 'Confirmed research', prompt: 'inspect synthetic evidence', workspace: directory, mode: 'read-only' },
      approval: { id: 'approval-confirmed-research', prompt: 'Start this exact read-only research?' },
    })
    assert.equal(await store.claimNextAction('worker', directory, '2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z'), undefined)
    await store.decideApproval('approval-confirmed-research', 'approved', { actor: 'owner' }, '2099-01-01T00:01:00.000Z')
    const claimed = await store.claimNextAction('worker', directory, '2099-01-01T00:02:00.000Z', '2099-01-01T01:02:00.000Z')
    assert.equal(claimed?.request.mode, 'read-only')
    assert.equal(claimed?.approvalGranted, true)
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('SQLite persists executor ids introduced by plugins without a kernel migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-open-executor-'))
  const store = await createSqliteStore(join(directory, 'assistant.sqlite3'), migrations)
  try {
    await store.migrate()
    await store.enqueueAction({
      actionId: 'action-custom', matterId: 'matter-custom', matterTitle: 'Custom harness', matterSummary: 'Plugin provider', intent: 'custom execution',
      source: { channel: 'test-channel' }, requestedExecutor: 'future-harness',
      request: { title: 'Custom harness', prompt: 'run', workspace: directory, mode: 'read-only' },
    })
    const claim = await store.claimNextAction('worker', directory, '2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z')
    assert.equal(claim?.requestedExecutor, 'future-harness')
    await store.settleAction('action-custom', 'worker', { actionId: 'action-custom', executor: 'future-harness', status: 'completed', summary: 'done' })
    assert.equal((await store.recentActions(10))[0]?.executor, 'future-harness')
  } finally {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('open executor migration preserves actions created by the closed schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-open-executor-upgrade-'))
  const migrationCopy = join(directory, 'migrations')
  const database = join(directory, 'assistant.sqlite3')
  await mkdir(migrationCopy)
  for (const file of (await readdir(migrations)).filter(file => file < '007_open_adapter_ids.sql')) {
    await copyFile(join(migrations, file), join(migrationCopy, file))
  }
  let store = await createSqliteStore(database, migrationCopy)
  try {
    await store.migrate()
    await store.enqueueAction({
      actionId: 'action-before-upgrade', matterId: 'matter-before-upgrade', matterTitle: 'Existing action', matterSummary: 'Must survive', intent: 'upgrade fixture',
      source: { channel: 'feishu' }, requestedExecutor: 'claude-code',
      request: { title: 'Existing action', prompt: 'run after upgrade', workspace: directory, mode: 'read-only' },
    })
    await store.close()
    await copyFile(join(migrations, '007_open_adapter_ids.sql'), join(migrationCopy, '007_open_adapter_ids.sql'))
    store = await createSqliteStore(database, migrationCopy)
    await store.migrate()
    const claim = await store.claimNextAction('worker', directory, '2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z')
    assert.equal(claim?.actionId, 'action-before-upgrade')
    await store.settleAction('action-before-upgrade', 'worker', { actionId: 'action-before-upgrade', executor: 'future-harness', status: 'completed', summary: 'preserved' })
    assert.equal((await store.recentActions(10))[0]?.executor, 'future-harness')
  } finally {
    await store.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})
