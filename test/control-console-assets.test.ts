import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('renders source, runtime assets, and module dependencies as separate console details', async () => {
  const [application, document] = await Promise.all([
    readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
  ])
  assert.match(application, /m\.dependsOn/)
  assert.match(application, /m\.runtimeDependsOn/)
  assert.match(application, /m\.requiresServices/)
  assert.match(application, /m\.providesServices/)
  assert.match(application, /m\.requiresEffects/)
  assert.match(application, /m\.providesEffects/)
  assert.match(application, /m\.mounts/)
  assert.match(application, /解析后的能力实现/)
  assert.match(application, /runtimeGraph\?\.edges/)
  assert.match(application, /runtimeGraph\?\.unresolved/)
  assert.match(application, /m\.assets/)
  assert.match(application, /showModule\(item\)/)
  assert.match(document, /点击模块查看源码、运行资产与依赖/)
  assert.match(document, /<th>依赖<\/th>/)
})
