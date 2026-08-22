import assert from 'node:assert/strict'
import test from 'node:test'
import { LarkCapabilityDiscovery, isVersionAtLeast } from '../src/lark/capabilities.js'
import type { CommandRunner } from '../src/lark/runner.js'

test('discovers event schemas at runtime and reports missing capabilities', async () => {
  const calls: string[][] = []
  const runner: CommandRunner = {
    async run(_executable, args) {
      calls.push([...args])
      if (args[0] === '--version') return { stdout: 'lark-cli version 1.2.3\n', stderr: '', exitCode: 0 }
      if (args[1] === 'list') return { stdout: '[{"key":"im.message.receive_v1"}]', stderr: '', exitCode: 0 }
      return {
        stdout: '{"key":"im.message.receive_v1","auth_types":["bot"],"scopes":["im:read"],"resolved_output_schema":{"type":"object"}}',
        stderr: '',
        exitCode: 0,
      }
    },
  }
  const report = await new LarkCapabilityDiscovery(runner).inspect(['im.message.receive_v1', 'card.action.trigger'])
  assert.equal(report.compatible, false)
  assert.deepEqual(report.missingEventKeys, ['card.action.trigger'])
  assert.equal(report.capabilities['im.message.receive_v1']?.authTypes[0], 'bot')
  assert.ok(calls.some((args) => args.join(' ') === 'event schema im.message.receive_v1 --json'))
})

test('compares CLI versions numerically', () => {
  assert.equal(isVersionAtLeast('1.0.88', '1.0.88'), true)
  assert.equal(isVersionAtLeast('1.1.0', '1.0.88'), true)
  assert.equal(isVersionAtLeast('1.0.9', '1.0.88'), false)
})
