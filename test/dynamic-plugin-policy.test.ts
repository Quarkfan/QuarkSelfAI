import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { dynamicPluginDecision } from '../src/runtime/dynamic-plugin-policy.js'

function execution(name: string, args: Record<string, unknown> = {}): ToolExecution {
  return {
    name,
    arguments: args,
    agent: { id: 'session-1' },
  } as unknown as ToolExecution
}

function context(hasClientHalf?: boolean): Context {
  return {
    dynamicCordisRunner: {
      snapshot: () => hasClientHalf === undefined ? [] : [{
        pluginId: 'demo-1',
        packages: [{ packageId: 'pkg-1', hasClientHalf }],
      }],
    },
  } as unknown as Context
}

test('allows read-only Cordis tools and the emergency stop path', () => {
  assert.deepEqual(dynamicPluginDecision(context(), execution('cordis_inspect_self')), { kind: 'allow' })
  assert.deepEqual(dynamicPluginDecision(context(), execution('cordis_define')), { kind: 'allow' })
  assert.deepEqual(dynamicPluginDecision(context(), execution('cordis_stop')), { kind: 'allow' })
})

test('asks once before activating host-only dynamic code', () => {
  const decision = dynamicPluginDecision(context(false), execution('cordis_run', {
    pluginId: 'demo-1', packageId: 'pkg-1', mode: 'run',
  }))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.kind === 'ask' ? decision.reason ?? '' : '', /确认本次启动或更新/)
})

test('leaves client-bearing packages to the native Cordis code approval', () => {
  assert.deepEqual(dynamicPluginDecision(context(true), execution('cordis_run', {
    pluginId: 'demo-1', packageId: 'pkg-1', mode: 'update',
  })), { kind: 'allow' })
})

test('fails closed when activation metadata cannot be resolved', () => {
  assert.equal(dynamicPluginDecision(context(), execution('cordis_run', {
    pluginId: 'missing-1', packageId: 'missing-pkg', mode: 'run',
  })).kind, 'ask')
})

test('asks before permanently removing an in-memory dynamic plugin', () => {
  const decision = dynamicPluginDecision(context(), execution('cordis_undefine', { pluginId: 'demo-1' }))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.kind === 'ask' ? decision.reason ?? '' : '', /永久移除/)
})
