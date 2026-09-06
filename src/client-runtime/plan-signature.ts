import { createPublicKey, verify } from 'node:crypto'
import type { PlanSignatureVerifierV1 } from './contracts.js'

const keyIdPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const signaturePattern = /^[A-Za-z0-9_-]{86}$/

/** Verifies the digest string covered by an execution-plan signature against one installation-pinned Ed25519 key. */
export class NodePinnedEd25519PlanVerifierV1 implements PlanSignatureVerifierV1 {
  readonly #key: ReturnType<typeof createPublicKey>
  constructor(private readonly keyId: string, publicKey: string) {
    if (!keyIdPattern.test(keyId) || !publicKey.startsWith('ed25519-spki:')) throw new Error('plan verification key is invalid')
    const bytes = Buffer.from(publicKey.slice('ed25519-spki:'.length), 'base64url')
    try {
      this.#key = createPublicKey({ key: bytes, format: 'der', type: 'spki' })
      if (this.#key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type')
    } catch { throw new Error('plan verification key is invalid') } finally { bytes.fill(0) }
  }

  async verify(input: { readonly keyId: string; readonly algorithm: 'ed25519'; readonly payloadDigest: string; readonly signature: string }): Promise<boolean> {
    if (input.keyId !== this.keyId || input.algorithm !== 'ed25519' || !digestPattern.test(input.payloadDigest) || !signaturePattern.test(input.signature)) return false
    const signature = Buffer.from(input.signature, 'base64url')
    try { return signature.byteLength === 64 && verify(null, Buffer.from(input.payloadDigest, 'utf8'), this.#key, signature) }
    catch { return false } finally { signature.fill(0) }
  }
}
