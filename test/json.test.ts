import assert from 'node:assert/strict'
import test from 'node:test'
import { parseJsonDocument } from '../src/lark/json.js'
import { runJson, type CommandRunner } from '../src/lark/runner.js'

test('parses JSON after a CLI upgrade banner', () => {
  assert.deepEqual(parseJsonDocument('A new version is available\n{"ok":true,"data":{"x":1}}'), {
    ok: true,
    data: { x: 1 },
  })
})

test('treats ok=false as failure even when process exits zero', async () => {
  const runner: CommandRunner = {
    async run() {
      return { stdout: '{"ok":false,"error":"denied"}', stderr: '', exitCode: 0 }
    },
  }
  await assert.rejects(runJson(runner, 'lark-cli', ['api']), /ok=false: denied/)
})
