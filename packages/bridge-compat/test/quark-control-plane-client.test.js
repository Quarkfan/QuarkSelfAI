import assert from 'node:assert/strict'
import test from 'node:test'
import { QuarkControlPlaneClient } from '../src/quark-control-plane-client.js'

test('submits a compiled policy through the authenticated local control plane', async () => {
  const calls = []
  const client = new QuarkControlPlaneClient({
    baseUrl: 'http://127.0.0.1:3210/',
    token: 'protected-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 201, json: async () => ({ ok: true, proposal: { id: 'policy-1', revision: 1 } }) }
    },
  })
  const proposal = await client.proposePolicy('普通消息汇总', { version: 1 })
  assert.deepEqual(proposal, { id: 'policy-1', revision: 1 })
  assert.equal(calls[0]?.url, 'http://127.0.0.1:3210/internal/policies/proposals')
  assert.equal(calls[0]?.options.headers.authorization, 'Bearer protected-token')
})

test('cannot activate a policy without forwarding explicit owner confirmation', async () => {
  const client = new QuarkControlPlaneClient({
    token: 'protected-token',
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body)
      assert.equal(payload.ownerConfirmed, false)
      return { ok: false, status: 400, json: async () => ({ ok: false, error: 'ownerConfirmed=true is required' }) }
    },
  })
  await assert.rejects(() => client.activatePolicy('policy-1', 1, false), /ownerConfirmed=true is required/)
})

test('evaluates enabled policies through the local authenticated control plane', async () => {
  const client = new QuarkControlPlaneClient({
    token: 'protected-token',
    fetchImpl: async (url, options) => {
      assert.match(url, /\/internal\/policies\/evaluate$/)
      assert.equal(JSON.parse(options.body).facts.source.chatId, 'oc_1')
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, evaluation: { effect: { attention: 'batch' }, matches: [{ id: 'policy-1' }] } }),
      }
    },
  })
  const result = await client.evaluatePolicies({ source: { chatId: 'oc_1' } })
  assert.equal(result.effect.attention, 'batch')
  assert.equal(result.matches.length, 1)
})
