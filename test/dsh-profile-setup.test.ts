import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { resolveDshProfileSetup } from '../scripts/dsh-profile-setup.js'

test('profile setup keeps compatibility and native composition explicit', () => {
  const cwd = '/workspace/quark'
  const compatibility = resolveDshProfileSetup({
    profile: 'feishu-assistant',
    profilePatch: 'compat/cordis.compat.patch.yml',
  }, {}, cwd)
  assert.equal(compatibility.profile, 'feishu-assistant')
  assert.equal(compatibility.profilePatch, resolve(cwd, 'compat/cordis.compat.patch.yml'))

  const native = resolveDshProfileSetup({
    profile: 'feishu-assistant-native',
    profileEnvironment: 'DSH_NATIVE_PROFILE',
    forbiddenProfiles: ['feishu-assistant'],
  }, { DSH_PROFILE: 'feishu-assistant' }, cwd)
  assert.equal(native.profile, 'feishu-assistant-native')
  assert.equal(native.profilePatch, undefined)
  assert.throws(() => resolveDshProfileSetup({
    profile: 'feishu-assistant-native',
    profileEnvironment: 'DSH_NATIVE_PROFILE',
    forbiddenProfiles: ['feishu-assistant'],
  }, { DSH_NATIVE_PROFILE: 'feishu-assistant' }, cwd), /reserved for a different runtime/)
})

test('profile setup accepts deployment paths without changing the profile contract', () => {
  const resolved = resolveDshProfileSetup({ profile: 'feishu-assistant-native' }, {
    DSH_HOME: '/var/lib/quark/dsh',
    DSH_CHECKOUT: '/opt/deepseek-harness',
  }, '/opt/quark')
  assert.equal(resolved.home, '/var/lib/quark/dsh')
  assert.equal(resolved.checkout, '/opt/deepseek-harness')
  assert.equal(resolved.profile, 'feishu-assistant-native')
})
