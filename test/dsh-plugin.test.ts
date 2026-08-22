import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.js'

test('loads as a DSH namespace plugin and mounts the Lark capability without starting consumers', async () => {
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'quark-self-ai')
  const ctx = new Context()
  const fiber = ctx.plugin(plugin, {
    executable: 'lark-cli-fixture',
    identity: 'bot',
    requiredEventKeys: ['im.message.receive_v1', 'card.action.trigger'],
  })
  await fiber
  assert.ok(ctx.larkCli instanceof plugin.LarkCliService)
  await ctx.fiber.dispose()
})
