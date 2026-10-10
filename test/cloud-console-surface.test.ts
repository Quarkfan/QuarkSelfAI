import assert from 'node:assert/strict'
import test from 'node:test'
import { cloudConsoleAssetV1 } from '../src/control-plane/cloud-console-surface.js'

test('serves a dependency-free same-origin Agent Studio without tenant data', () => {
  const page = cloudConsoleAssetV1({ method: 'GET', path: '/' })
  assert.equal(page?.status, 200)
  assert.equal(page?.contentType, 'text/html; charset=utf-8')
  assert.match(String(page?.body), /Agent Studio/)
  assert.match(String(page?.body), /CLOUD CONTROL \/ EFFECTS OFF/)
  assert.doesNotMatch(String(page?.body), /test\.alpha|session:|\/Users\//)

  const script = String(cloudConsoleAssetV1({ method: 'GET', path: '/agent-studio.js' })?.body)
  for (const endpoint of ['/v1/auth/login', '/v1/auth/me', '/v1/agent-drafts', '/v1/capabilities', '/v1/devices', '/v1/agent-drafts/publish-test', '/v1/agent-drafts/dispatch-test']) assert.match(script, new RegExp(endpoint.replaceAll('/', '\\/')))
  assert.match(script, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(script, /allowMidActionSwitch:false/)
  assert.match(script, /workspaceHandles:\[\],permissions:\[\]/)
  assert.match(script, /externalWritesEnabled/)
  assert.doesNotMatch(script, /localStorage|document\.cookie|eval\(|new Function/)
})

test('exposes only fixed GET assets and leaves API routing to the shared host', () => {
  assert.equal(cloudConsoleAssetV1({ method: 'GET', path: '/missing' }), undefined)
  assert.equal(cloudConsoleAssetV1({ method: 'POST', path: '/', body: {} }), undefined)
  assert.equal(cloudConsoleAssetV1({ method: 'GET', path: '/v1/health' }), undefined)
  const style = cloudConsoleAssetV1({ method: 'GET', path: '/agent-studio.css' })
  assert.equal(style?.contentType, 'text/css; charset=utf-8')
  assert.match(String(style?.body), /\[hidden\]\{display:none!important\}/)
})
