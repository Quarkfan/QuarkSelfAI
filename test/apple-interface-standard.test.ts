import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('loads semantic tokens first and the mandatory interaction baseline last', async () => {
  const document = await readFile(new URL('../web/index.html', import.meta.url), 'utf8')
  const tokens = document.indexOf('/design-tokens.css')
  const pageStyles = document.indexOf('/styles.css')
  const baseline = document.indexOf('/interface-baseline.css')
  assert.ok(tokens >= 0 && tokens < pageStyles)
  assert.ok(baseline > document.indexOf('/conversation.css'))
})

test('enforces the Apple HIG inspired accessibility and interaction contract', async () => {
  const [tokens, baseline, application, document] = await Promise.all([
    readFile(new URL('../web/design-tokens.css', import.meta.url), 'utf8'),
    readFile(new URL('../web/interface-baseline.css', import.meta.url), 'utf8'),
    readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
  ])
  assert.match(tokens, /--q-control-hit-size:\s*44px/)
  assert.match(tokens, /-apple-system/)
  assert.match(tokens, /prefers-contrast:\s*more/)
  assert.match(baseline, /:focus-visible/)
  assert.match(baseline, /prefers-reduced-motion:\s*reduce/)
  assert.match(baseline, /forced-colors:\s*active/)
  assert.match(baseline, /max-width:\s*900px/)
  assert.doesNotMatch(baseline, /\.metric-grid,\s*\.halves/)
  assert.match(document, /aria-label="主导航"/)
  assert.match(document, /aria-label="退出登录"/)
  assert.match(application, /setAttribute\('aria-current','page'\)/)
})

test('presents the console as a quiet attention-first operating layer', async () => {
  const [document, redesign] = await Promise.all([
    readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../web/console-redesign.css', import.meta.url), 'utf8'),
  ])
  assert.match(document, /今天，需要你关注的事情/)
  assert.match(document, /只把决定、风险与下一步带到这里/)
  assert.equal((document.match(/class="nav-icon"/g) ?? []).length, 9)
  assert.match(document, /工作账本/)
  assert.ok(document.indexOf('/console-redesign.css') < document.indexOf('/interface-baseline.css'))
  assert.match(redesign, /Quiet Intelligence/)
  assert.match(redesign, /\.metric-grid article\.attention/)
  assert.match(redesign, /@media \(max-width: 560px\)/)
})
