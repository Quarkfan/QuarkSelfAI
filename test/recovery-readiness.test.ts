import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolve } from 'node:path'
import {
  auditRecoveryReadiness,
  expandSelector,
  isRequired,
  normalizeGitRemote,
} from '../scripts/audit-recovery-readiness.js'

test('expands recovery selectors without reading their contents', () => {
  const context = {
    projectRoot: '/project',
    home: '/home/person',
    environment: { COMPAT_CONFIG_PATH: '/secure/compat.json' },
  }
  assert.equal(expandSelector('${PROJECT_ROOT}/var/state.db', context), '/project/var/state.db')
  assert.equal(expandSelector('${HOME}/.lark-cli/config.json', context), '/home/person/.lark-cli/config.json')
  assert.equal(expandSelector('${ENV:COMPAT_CONFIG_PATH}', context), '/secure/compat.json')
  assert.equal(expandSelector('${ENV:MISSING}', context), undefined)
})

test('applies storage and compatibility conditions explicitly', () => {
  assert.equal(isRequired('always', { storage: 'postgres', mode: 'native' }), true)
  assert.equal(isRequired('sqlite', { storage: 'sqlite', mode: 'native' }), true)
  assert.equal(isRequired('sqlite', { storage: 'postgres', mode: 'native' }), false)
  assert.equal(isRequired('compatibility', { storage: 'sqlite', mode: 'compat' }), true)
  assert.equal(isRequired('optional', { storage: 'sqlite', mode: 'compatibility' }), false)
})

test('accepts equivalent GitHub SSH and HTTPS repository identities', () => {
  assert.equal(normalizeGitRemote('git@github.com:Quarkfan/QuarkSelfAI.git'), 'github.com:Quarkfan/QuarkSelfAI')
  assert.equal(normalizeGitRemote('https://github.com/Quarkfan/QuarkSelfAI.git'), 'github.com:Quarkfan/QuarkSelfAI')
})

test('keeps the recovery manifest portable and reports missing external resources', async () => {
  const root = process.cwd()
  const manifest = JSON.parse(await readFile(resolve(root, 'config/recovery-manifest.json'), 'utf8')) as {
    runtime: { requiredCommands: string[] }
    artifacts: Array<{ id: string; selector: string; selectorKind?: string }>
  }
  assert.equal(manifest.artifacts.some(item => item.selector.includes('/Users/')), false)
  assert.ok(manifest.runtime.requiredCommands.includes('lark-cli'))
  assert.ok(manifest.runtime.requiredCommands.includes('dida-cli'))
  assert.ok(manifest.runtime.requiredCommands.includes('codex'))
  assert.ok(manifest.runtime.requiredCommands.includes('claude'))
  assert.equal(manifest.artifacts.find(item => item.id === 'primary-postgres')?.selectorKind, 'environment')
  assert.ok(manifest.artifacts.some(item => item.id === 'compatibility-state'))
  const report = await auditRecoveryReadiness(root)
  assert.equal(report.source.originMatches, true)
  assert.ok(report.resources.some(item => item.id === 'encrypted-off-device-target'))
  assert.ok(report.resources.some(item => item.id === 'backup-encryption-recipient'))
})
