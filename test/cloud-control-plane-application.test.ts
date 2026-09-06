import assert from 'node:assert/strict'
import test from 'node:test'
import type { PersistentAgentStudioPortV1, PersistentCapabilityRegistryPortV1, TenantContextV1 } from '../src/control-plane/contracts.js'
import { InactiveCloudControlPlaneApplicationV1 } from '../src/control-plane/cloud-application.js'

const alpha: TenantContextV1 = { tenantId: 'test.alpha', userId: 'owner', roles: ['owner'] }
const beta: TenantContextV1 = { tenantId: 'test.beta', userId: 'owner', roles: ['owner'] }

function harness() {
  const observed: TenantContextV1[] = []
  const capabilities = {
    async listVisible(context: TenantContextV1) { observed.push(context); return [] },
    async registerInactive(context: TenantContextV1) { observed.push(context); return { tenantId: context.tenantId } as never },
    async get() { return undefined }, async close() {},
  } satisfies PersistentCapabilityRegistryPortV1
  const studio = {
    async listDrafts(context: TenantContextV1) { observed.push(context); return [] },
    async saveDraft(context: TenantContextV1) { observed.push(context); return { tenantId: context.tenantId } as never },
    async publishTest(context: TenantContextV1) { observed.push(context); return { tenantId: context.tenantId } as never },
    async getDraft() { return undefined }, async close() {},
  } satisfies PersistentAgentStudioPortV1
  const identity = { async resolveSession(reference: string) { return reference === 'session:alpha' ? alpha : reference === 'session:beta' ? beta : undefined } }
  const devices = {
    async registerDevice(context: TenantContextV1) { observed.push(context); return { tenantId: context.tenantId } as never },
    async listDevices(context: TenantContextV1) { observed.push(context); return [] },
  }
  return { app: new InactiveCloudControlPlaneApplicationV1(identity, capabilities, studio, devices), observed }
}

test('derives tenant and user only from the authenticated session on every operation', async () => {
  const { app, observed } = harness()
  await app.listCapabilities('session:alpha')
  await app.listAgentDrafts('session:beta')
  await app.saveAgentDraft('session:alpha', { draftId: 'draft.one', blueprint: {} as never, expectedRevision: 0 })
  await app.publishAgentTest('session:beta', { draftId: 'draft.one', expectedRevision: 1 })
  await app.registerDevice('session:alpha', { deviceId: 'device.one', publicKey: 'public-key' })
  await app.listDevices('session:beta')
  assert.deepEqual(observed.map(context => context.tenantId), ['test.alpha', 'test.beta', 'test.alpha', 'test.beta', 'test.alpha', 'test.beta'])
  assert.ok(observed.every(context => Object.isFrozen(context) && context.userId === 'owner'))
})

test('fails before a provider call for raw, malformed or unknown session material', async () => {
  const { app, observed } = harness()
  await assert.rejects(() => app.listCapabilities('token=plaintext'), /invalid/)
  await assert.rejects(() => app.listCapabilities('session:missing'), /not authenticated/)
  await assert.rejects(() => app.listCapabilities('/Users/example/session'), /invalid/)
  assert.deepEqual(observed, [])
})
