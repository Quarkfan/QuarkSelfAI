import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const projectRoot = process.cwd()
const checkout = resolve(projectRoot, process.env.DSH_CHECKOUT ?? '../deepseek-harness')
const validationHome = resolve(projectRoot, process.env.DSH_VALIDATION_HOME ?? 'var/dsh-validation')
const baseline = JSON.parse(await readFile(resolve(projectRoot, 'compat/dsh-baseline.json'), 'utf8')) as {
  version: string
  sourceCommit: string
}
const manifest = JSON.parse(await readFile(resolve(checkout, 'apps/cli/package.json'), 'utf8')) as { version?: string }
assert.equal(manifest.version, baseline.version, 'DSH checkout version differs from the compatibility baseline')
const { stdout: revision } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout })
assert.equal(revision.trim(), baseline.sourceCommit, 'DSH checkout commit differs from the compatibility baseline')

const plugin = await import(resolve(projectRoot, 'dist/index.js'))
assert.equal('default' in plugin, false, 'DSH namespace plugin must not expose a default export')
assert.equal(typeof plugin.apply, 'function', 'DSH namespace plugin must expose apply(ctx, config)')

const { stdout: dump } = await exec('corepack', [
  'pnpm', 'dsh', '--profile', 'feishu-assistant', '--dump-config',
], {
  cwd: checkout,
  env: { ...process.env, DSH_HOME: validationHome },
  maxBuffer: 4 * 1024 * 1024,
})
assert.match(dump, /# == @quarkfan\/quark-self-ai/)
assert.match(dump, /id: feishu-lark-cli[\s\S]*name: '@quarkfan\/quark-self-ai'/)
process.stdout.write(`DSH compatibility verified version=${baseline.version} commit=${baseline.sourceCommit} profile=feishu-assistant\n`)
