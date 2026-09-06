import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorCapabilityReportV1 } from '../src/client-runtime/contracts.js'
import { prepareInactiveExecutablePilotPreflight } from '../src/client-runtime/executable-pilot.js'

const now = new Date('2026-09-06T00:00:00.000Z')

function report(executorId: string, availability: ExecutorCapabilityReportV1['availability']): ExecutorCapabilityReportV1 {
  return {
    schemaVersion: 1,
    deviceId: 'device.owner',
    executorId,
    availability,
    version: availability === 'ready' ? '1.0.0' : null,
    protocolVersions: availability === 'ready' ? ['envelope.v1'] : [],
    capabilities: availability === 'ready' ? ['agent.execute', 'tool.execute', ...(executorId === 'dsh' ? [] : ['session.continue'])] : [],
    constraints: ['local-only', 'no-mid-action-switch'],
    discoveredAt: now.toISOString(),
    expiresAt: '2026-09-06T00:05:00.000Z',
  }
}

test('selects DSH only after preferred executors are unavailable and remains unarmed', () => {
  const preflight = prepareInactiveExecutablePilotPreflight({
    tenantId: 'test.alpha',
    deviceId: 'device.owner',
    reports: [report('claude-code', 'not-installed'), report('codex', 'auth-required'), report('dsh', 'ready')],
  }, now)
  assert.deepEqual({
    selected: preflight.selectedExecutorId,
    reason: preflight.selectionReason,
    state: preflight.state,
    listener: preflight.listenerStarted,
    invoked: preflight.executorInvoked,
    writes: preflight.externalWritesEnabled,
    owner: preflight.currentOwnerPreserved,
  }, { selected: 'dsh', reason: 'fallback-ready', state: 'ready-unarmed', listener: false, invoked: false, writes: false, owner: true })
  assert.ok(Object.isFrozen(preflight) && Object.isFrozen(preflight.reportDigests))
})

test('blocks when no executor is ready and rejects incomplete or cross-device evidence', () => {
  const unavailable = [report('claude-code', 'not-installed'), report('codex', 'auth-required'), report('dsh', 'unavailable')]
  assert.equal(prepareInactiveExecutablePilotPreflight({ tenantId: 'test.alpha', deviceId: 'device.owner', reports: unavailable }, now).state, 'blocked-unarmed')
  assert.throws(() => prepareInactiveExecutablePilotPreflight({ tenantId: 'tenant.alpha', deviceId: 'device.owner', reports: unavailable }, now), /test tenant/)
  assert.throws(() => prepareInactiveExecutablePilotPreflight({ tenantId: 'test.alpha', deviceId: 'device.owner', reports: unavailable.slice(0, 2) }, now), /every supported executor/)
  assert.throws(() => prepareInactiveExecutablePilotPreflight({ tenantId: 'test.alpha', deviceId: 'device.owner', reports: [...unavailable.slice(0, 2), { ...unavailable[2]!, deviceId: 'device.other' }] }, now), /scope is incomplete/)
})
