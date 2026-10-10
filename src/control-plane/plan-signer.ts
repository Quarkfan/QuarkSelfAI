import { createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto'
import type { ExecutionPlanSignerV1 } from './contracts.js'

const digestPattern = /^sha256:[a-f0-9]{64}$/
const publicKeyPrefix = 'ed25519-spki:'
const keyIdPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/

/** Server-local Ed25519 signer. Private material is parsed once and never exposed. */
export class NodeEd25519ExecutionPlanSignerV1 implements ExecutionPlanSignerV1 {
  readonly #key: KeyObject

  constructor(readonly keyId: string, privateKeyBytes: Uint8Array, expectedPublicKey: string) {
    if (!keyIdPattern.test(keyId) || !expectedPublicKey.startsWith(publicKeyPrefix) || privateKeyBytes.byteLength < 32 || privateKeyBytes.byteLength > 16_384) throw new Error('execution plan signing identity is invalid')
    try {
      this.#key = createPrivateKey(Buffer.from(privateKeyBytes))
      if (this.#key.asymmetricKeyType !== 'ed25519') throw new Error('not-ed25519')
      const actual = `${publicKeyPrefix}${(createPublicKey(this.#key).export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`
      if (actual !== expectedPublicKey) throw new Error('public-key-mismatch')
    } catch { throw new Error('execution plan signing key is invalid') }
  }

  async sign(input: { readonly algorithm: 'ed25519'; readonly payloadDigest: string }): Promise<string> {
    if (input.algorithm !== 'ed25519' || !digestPattern.test(input.payloadDigest)) throw new Error('execution plan signing input is invalid')
    return sign(null, Buffer.from(input.payloadDigest, 'utf8'), this.#key).toString('base64url')
  }
}
