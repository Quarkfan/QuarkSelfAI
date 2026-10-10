import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { NodePinnedEd25519PlanVerifierV1 } from '../src/client-runtime/plan-signature.js'
import { NodeEd25519ExecutionPlanSignerV1 } from '../src/control-plane/plan-signer.js'

test('signs only canonical execution-plan digests with the pinned server identity', async () => {
  const pair = generateKeyPairSync('ed25519')
  const privateBytes = Buffer.from(pair.privateKey.export({ format: 'pem', type: 'pkcs8' }))
  const publicKey = `ed25519-spki:${(pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
  const digest = `sha256:${'a'.repeat(64)}`
  try {
    const signer = new NodeEd25519ExecutionPlanSignerV1('control.primary', privateBytes, publicKey)
    const signature = await signer.sign({ algorithm: 'ed25519', payloadDigest: digest })
    assert.equal(await new NodePinnedEd25519PlanVerifierV1('control.primary', publicKey).verify({ keyId: signer.keyId, algorithm: 'ed25519', payloadDigest: digest, signature }), true)
    await assert.rejects(() => signer.sign({ algorithm: 'ed25519', payloadDigest: 'not-a-digest' }), /signing input/)
  } finally { privateBytes.fill(0) }
})

test('rejects a private key that does not match the pinned public identity', () => {
  const first = generateKeyPairSync('ed25519'); const second = generateKeyPairSync('ed25519')
  const privateBytes = Buffer.from(first.privateKey.export({ format: 'pem', type: 'pkcs8' }))
  const publicKey = `ed25519-spki:${(second.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
  try { assert.throws(() => new NodeEd25519ExecutionPlanSignerV1('control.primary', privateBytes, publicKey), /signing key/) }
  finally { privateBytes.fill(0) }
})
