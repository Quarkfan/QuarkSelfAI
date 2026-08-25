import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { eventRecordId, type NormalizedChannelEvent } from '../src/domain/contracts.js'
import { apply } from '../src/lark/ingress-plugin.js'

const event: NormalizedChannelEvent = {
  kind: 'message.received',
  source: { channel: 'feishu', eventId: 'evt-1', resourceId: 'om-1' },
  eventKey: 'im.message.receive_v1',
  deduplicationKey: 'im.message.receive_v1:evt-1',
  payload: { text: 'normalized' },
  raw: { event_id: 'evt-1', newly_added_field: true },
}

test('builds the same durable journal id for every ingress implementation', () => {
  assert.equal(eventRecordId(event), 'event:feishu:im.message.receive_v1:evt-1')
})

test('native ingress journals an event without starting a consumer by default', async () => {
  let listener: ((event: NormalizedChannelEvent) => Promise<void>) | undefined
  const appended: NormalizedChannelEvent[] = []
  let starts = 0
  const ctx = {
    on(name: string, callback: (event: NormalizedChannelEvent) => Promise<void>) {
      assert.equal(name, 'feishu/event')
      listener = callback
    },
    quarkEventAppendState: { async appendEvent(value: NormalizedChannelEvent) { appended.push(value); return { inserted: true } } },
    larkCli: { async start() { starts += 1 }, async stop() {} },
  } as unknown as Context
  await apply(ctx)
  await listener?.(event)
  assert.deepEqual(appended, [event])
  assert.equal(starts, 0)
})
