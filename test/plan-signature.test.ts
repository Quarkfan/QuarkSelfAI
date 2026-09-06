import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import { NodePinnedEd25519PlanVerifierV1 } from '../src/client-runtime/plan-signature.js'

test('verifies only the exact digest and key id against an installation-pinned Ed25519 key', async () => {
  const pair = generateKeyPairSync('ed25519'); const keyId = 'control.primary'; const payloadDigest = `sha256:${'a'.repeat(64)}`
  const publicKey = `ed25519-spki:${(pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
  const signature = sign(null, Buffer.from(payloadDigest), pair.privateKey).toString('base64url')
  const verifier = new NodePinnedEd25519PlanVerifierV1(keyId, publicKey)
  assert.equal(await verifier.verify({ keyId, algorithm: 'ed25519', payloadDigest, signature }), true)
  assert.equal(await verifier.verify({ keyId: 'control.other', algorithm: 'ed25519', payloadDigest, signature }), false)
  assert.equal(await verifier.verify({ keyId, algorithm: 'ed25519', payloadDigest: `sha256:${'b'.repeat(64)}`, signature }), false)
  assert.equal(await verifier.verify({ keyId, algorithm: 'ed25519', payloadDigest, signature: 'invalid' }), false)
})

test('rejects malformed and non-Ed25519 installation keys', () => {
  assert.throws(() => new NodePinnedEd25519PlanVerifierV1('control.primary', 'ed25519-spki:not-a-key'), /invalid/)
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  assert.throws(() => new NodePinnedEd25519PlanVerifierV1('control.primary', `ed25519-spki:${rsa.toString('base64url')}`), /invalid/)
})
