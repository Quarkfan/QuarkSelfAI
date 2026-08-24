import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('renders source and runtime module dependencies as separate console details', async () => {
  const [application, document] = await Promise.all([
    readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
  ])
  assert.match(application, /m\.dependsOn/)
  assert.match(application, /m\.runtimeDependsOn/)
  assert.match(application, /showModule\(item\)/)
  assert.match(document, /点击模块查看源码与运行依赖/)
  assert.match(document, /<th>依赖<\/th>/)
})
