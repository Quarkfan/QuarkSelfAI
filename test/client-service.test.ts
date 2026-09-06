import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { prepareInactiveClientLaunchd, prepareInactiveClientSystemd } from '../src/client-runtime/client-service.js'

const options = { installRoot: '/Users/test/QuarkClient', nodeExecutable: '/opt/node/bin/node', workspacePath: '/Users/test/Workspace', stdoutPath: '/Users/test/Library/Logs/quark-client.out', stderrPath: '/Users/test/Library/Logs/quark-client.err', executablePath: '/opt/node/bin:/usr/bin:/bin' }

test('prepares but does not register or start a path-bound launchd client', async () => {
  const template = await readFile(new URL('../deploy/launchd/com.quarkfan.quark-client.plist.template', import.meta.url), 'utf8')
  const result = prepareInactiveClientLaunchd(template, options)
  assert.equal(result.state, 'prepared-inactive'); assert.equal(result.registered, false); assert.equal(result.started, false); assert.equal(result.externalWritesEnabled, false)
  assert.match(result.definition, /QuarkClient\/program\/dist\/client-runtime\/client-entry\.js/); assert.match(result.definition, /QUARK_CLIENT_ENABLE_NO_EFFECT_WORKER/)
  assert.doesNotMatch(result.definition, /RunAtLoad|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY/)
  assert.deepEqual(result.rollback, { stopBeforeRemove: true, removeDefinitionOnly: true, preserveInstallationState: true })
})

test('prepares a non-repository systemd client and rejects ambiguous paths', async () => {
  const template = await readFile(new URL('../deploy/systemd/quark-client.service.template', import.meta.url), 'utf8')
  const result = prepareInactiveClientSystemd(template, { ...options, installRoot: '/opt/quark-client', workspacePath: '/srv/workspace', stdoutPath: '/var/log/quark-client.out', stderrPath: '/var/log/quark-client.err' })
  assert.match(result.definition, /WorkingDirectory=\/opt\/quark-client\/program/); assert.match(result.definition, /ExecStart=\/opt\/node\/bin\/node \/opt\/quark-client\/program\/dist\/client-runtime\/client-entry\.js run/)
  assert.doesNotMatch(result.definition, /API_KEY|TOKEN|PASSWORD|PRIVATE_KEY/)
  assert.throws(() => prepareInactiveClientSystemd(template, { ...options, installRoot: '/opt/Quark Client' }), /whitespace/)
})
