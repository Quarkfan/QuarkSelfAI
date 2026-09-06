import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverBundledDsh } from '../src/client-runtime/bundled-dsh-discovery.js'

const packages = ['dsh', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-subagent', 'dsh-tools']
const runtimePackages = Object.fromEntries(packages.map(name => [`@deepseek-ai/${name}`, '1.2.3']))
runtimePackages['@deepseek-ai/cordis-plugin-group'] = '1.0.1'

test('discovers the repository-locked DSH closure and reports only inference configuration presence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-dsh-discovery-'))
  try {
    await mkdir(join(root, 'config'), { recursive: true })
    const dependencies = Object.fromEntries(packages.map(name => [`@deepseek-ai/${name}`, '1.2.3']))
    dependencies['@deepseek-ai/cordis-plugin-group'] = '1.0.1'
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies }))
    await writeFile(join(root, 'config/dsh-baseline.json'), JSON.stringify({ version: '1.2.3', fallbackRuntimePackages: runtimePackages }))
    for (const name of packages) { const folder = join(root, 'node_modules/@deepseek-ai', name); await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '1.2.3', ...(name === 'dsh' ? { bin: { dsh: 'lib/bin.js' } } : {}) })) }
    await mkdir(join(root, 'node_modules/@deepseek-ai/cordis-plugin-group'), { recursive: true })
    await writeFile(join(root, 'node_modules/@deepseek-ai/cordis-plugin-group/package.json'), JSON.stringify({ version: '1.0.1' }))
    await mkdir(join(root, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
    await writeFile(join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '#!/usr/bin/env node\n')
    const ready = await discoverBundledDsh(root, { QUARK_INFERENCE_BASE_URL: 'opaque', QUARK_INFERENCE_API_KEY: 'never-return' })
    assert.deepEqual({ installation: ready.installation, version: ready.version, host: ready.hostEntrypoint, auth: ready.authentication }, { installation: 'detected', version: '1.2.3', host: 'detected', auth: 'ready' })
    assert.equal(JSON.stringify(ready).includes('never-return'), false)
    assert.equal((await discoverBundledDsh(root, {})).authentication, 'required')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not advertise DSH without the product headless entrypoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-dsh-discovery-'))
  try {
    await mkdir(join(root, 'config'), { recursive: true })
    const dependencies = Object.fromEntries(packages.map(name => [`@deepseek-ai/${name}`, '1.2.3']))
    dependencies['@deepseek-ai/cordis-plugin-group'] = '1.0.1'
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies }))
    await writeFile(join(root, 'config/dsh-baseline.json'), JSON.stringify({ version: '1.2.3', fallbackRuntimePackages: runtimePackages }))
    for (const name of packages) { const folder = join(root, 'node_modules/@deepseek-ai', name); await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '1.2.3', ...(name === 'dsh' ? { bin: { dsh: 'lib/bin.js' } } : {}) })) }
    await mkdir(join(root, 'node_modules/@deepseek-ai/cordis-plugin-group'), { recursive: true })
    await writeFile(join(root, 'node_modules/@deepseek-ai/cordis-plugin-group/package.json'), JSON.stringify({ version: '1.0.1' }))
    const report = await discoverBundledDsh(root, { QUARK_INFERENCE_BASE_URL: 'x', QUARK_INFERENCE_API_KEY: 'y' })
    assert.equal(report.hostEntrypoint, 'missing')
    assert.equal(report.authentication, 'required')
    assert.deepEqual(report.capabilities, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reports package drift instead of treating a partial closure as fallback-ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quark-dsh-discovery-'))
  try {
    await mkdir(join(root, 'config'), { recursive: true }); await mkdir(join(root, 'node_modules/@deepseek-ai/dsh-agent'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh-agent': '1.2.3' } }))
    await writeFile(join(root, 'config/dsh-baseline.json'), JSON.stringify({ version: '1.2.3', fallbackRuntimePackages: runtimePackages }))
    await writeFile(join(root, 'node_modules/@deepseek-ai/dsh-agent/package.json'), JSON.stringify({ version: '1.2.4' }))
    assert.equal((await discoverBundledDsh(root, { QUARK_INFERENCE_BASE_URL: 'x', QUARK_INFERENCE_API_KEY: 'y' })).installation, 'package-drift')
  } finally { await rm(root, { recursive: true, force: true }) }
})
