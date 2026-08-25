import assert from 'node:assert/strict'
import test from 'node:test'
import { requireAuthorizationEvidence } from '../src/domain/authorization.js'

const evidence = {
  id: 'authorization:deployment:v1',
  grantedBy: 'release-controller',
  grantedAt: '2026-08-25T00:00:00Z',
  scope: 'deployment.promote',
  revision: 1,
  source: 'approved-release-policy',
}

test('authorization skeleton validates a caller-selected grantor without knowing product roles', () => {
  assert.deepEqual(requireAuthorizationEvidence(
    evidence,
    { scope: 'deployment.promote', grantedBy: 'release-controller' },
    '2026-08-25T01:00:00Z',
  ), evidence)
  assert.throws(() => requireAuthorizationEvidence(
    evidence,
    { scope: 'deployment.promote', grantedBy: 'security-controller' },
    '2026-08-25T01:00:00Z',
  ), /must be granted by security-controller/)
})
