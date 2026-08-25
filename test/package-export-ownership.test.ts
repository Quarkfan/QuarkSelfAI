import assert from 'node:assert/strict'
import test from 'node:test'
import { validateTrackedPackageExportOwnership } from '../src/architecture/package-exports.js'

const contractExport = {
  './contract': {
    import: './dist/contracts/public.js',
    types: './dist/contracts/public.d.ts',
  },
}

function validate(
  exports: Readonly<Record<string, unknown>>,
  tracked: readonly string[],
  owners: readonly (readonly [string, string])[],
  plugins: readonly (readonly [string, string])[] = [],
): void {
  validateTrackedPackageExportOwnership(exports, new Set(tracked), {
    ownerByPath: new Map(owners),
    pluginOwnerByExport: new Map(plugins),
  })
}

test('accepts a tracked public contract whose runtime and types resolve to one owner', () => {
  assert.doesNotThrow(() => validate(
    contractExport,
    ['src/contracts/public.ts'],
    [['src/contracts/public.ts', 'public-contract']],
  ))
})

test('rejects unowned and cross-owner package targets', () => {
  assert.throws(() => validate(contractExport, ['src/contracts/public.ts'], []), /has no module owner/)
  assert.throws(() => validate({
    './client': { default: './web/client.js', types: './web/client.d.ts' },
  }, ['web/client.js', 'web/client.d.ts'], [
    ['web/client.js', 'client-runtime'],
    ['web/client.d.ts', 'client-types'],
  ]), /different module owners/)
})

test('ignores a fully untracked local experiment but rejects partial entry into Git', () => {
  const client = { './client': { default: './web/client.js', types: './web/client.d.ts' } }
  assert.doesNotThrow(() => validate(client, [], []))
  assert.throws(() => validate(client, ['web/client.js'], [
    ['web/client.js', 'client-surface'],
  ]), /mixes tracked and untracked targets/)
})

test('requires a plugin export target to agree with its catalog binding', () => {
  assert.throws(() => validate(
    contractExport,
    ['src/contracts/public.ts'],
    [['src/contracts/public.ts', 'public-contract']],
    [['./contract', 'other-module']],
  ), /differs from its module binding/)
})

test('allows only the exact package metadata export', () => {
  assert.doesNotThrow(() => validate({ './package.json': './package.json' }, [], []))
  assert.throws(() => validate({ './package.json': './other.json' }, [], []), /must point to package.json/)
})
