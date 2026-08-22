import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderLaunchdTemplate } from '../src/deploy/launchd.js'

test('renders a restart-on-failure LaunchAgent without embedding secrets', async () => {
  const template = await readFile(fileURLToPath(new URL('../deploy/launchd/com.quarkfan.quark-self-ai.plist.template', import.meta.url)), 'utf8')
  const rendered = renderLaunchdTemplate(template, {
    projectRoot: '/Users/test/Quark & SelfAI',
    nodeExecutable: '/opt/node/bin/node',
    environmentFile: '/Users/test/.config/quark/runtime.env',
    executablePath: '/opt/node/bin:/usr/bin:/bin',
    stdoutPath: '/Users/test/Library/Logs/quark.out.log',
    stderrPath: '/Users/test/Library/Logs/quark.err.log',
  })
  assert.match(rendered, /Quark &amp; SelfAI/)
  assert.match(rendered, /<key>SuccessfulExit<\/key>\s*<false\/>/)
  assert.match(rendered, /--env-file=\/Users\/test\/\.config\/quark\/runtime\.env/)
  assert.match(rendered, /<key>PATH<\/key>\s*<string>\/opt\/node\/bin:\/usr\/bin:\/bin<\/string>/)
  assert.doesNotMatch(rendered, /CONTROL_PLANE_TOKEN|CONSOLE_TOKEN/)
})
