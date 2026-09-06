import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import type { DeviceIdentityV1, DeviceProofVerifierV1, DeviceSessionChallengeV1, DeviceSessionProofV1, LocalDeviceSecretStoreV1 } from './contracts.js'
export type { LocalDeviceSecretStoreV1, RemovableLocalDeviceSecretStoreV1 } from './contracts.js'
import { validateDeviceIdentity } from './validation.js'

const secretReferencePattern = /^(?:secret|keychain):[a-z0-9][a-z0-9._:-]{0,127}$/
const publicKeyPrefix = 'ed25519-spki:'
const proofDomain = 'quark-device-proof-v1\0'

export interface DeviceEnrollmentMaterialV1 {
  readonly identity: DeviceIdentityV1
  readonly privateKeyRef: string
  readonly publicKeyId: string
}

/** Proves that a recovered local secret is the private half of the persisted public identity. */
export async function assertDeviceEnrollmentSecret(identityInput: DeviceIdentityV1, privateKeyRef: string, secrets: LocalDeviceSecretStoreV1): Promise<void> {
  const identity = validateDeviceIdentity(identityInput)
  if (!secretReferencePattern.test(privateKeyRef)) throw new Error('device enrollment secret reference is invalid')
  const secret = await secrets.get(privateKeyRef)
  if (!secret) throw new Error('device private key is unavailable')
  const privateBytes = Buffer.from(secret)
  try {
    const privateKey = createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' })
    const derivedPublic = encodePublicKey(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer)
    if (derivedPublic !== identity.publicKey) throw new Error('device private key does not match enrolled public identity')
  } finally { privateBytes.fill(0); secret.fill(0) }
}

/** Generates a real Ed25519 identity while returning only public metadata and an opaque local reference. */
export async function createEd25519DeviceEnrollment(input: {
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly privateKeyRef: string
  readonly attestationReference?: string
}, secrets: LocalDeviceSecretStoreV1, now = new Date()): Promise<DeviceEnrollmentMaterialV1> {
  if (!secretReferencePattern.test(input.privateKeyRef) || Number.isNaN(now.getTime())) throw new Error('device enrollment secret reference or timestamp is invalid')
  if (await secrets.get(input.privateKeyRef)) throw new Error('device enrollment secret reference already exists')
  const pair = generateKeyPairSync('ed25519')
  const publicKey = encodePublicKey(pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer)
  const identity = validateDeviceIdentity({
    schemaVersion: 1,
    tenantId: input.tenantId,
    userId: input.userId,
    deviceId: input.deviceId,
    publicKey,
    keyAlgorithm: 'ed25519',
    createdAt: now.toISOString(),
    attestation: { kind: 'self', reference: input.attestationReference ?? 'self:ed25519' },
  })
  const privateBytes = pair.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer
  try { await secrets.put(input.privateKeyRef, Uint8Array.from(privateBytes)) } finally { privateBytes.fill(0) }
  return deepFreeze({ identity: structuredClone(identity), privateKeyRef: input.privateKeyRef, publicKeyId: keyId(publicKey) })
}

/** Signs only the domain-separated server nonce after exact device scope validation. */
export async function signDeviceSessionChallenge(input: {
  readonly identity: DeviceIdentityV1
  readonly privateKeyRef: string
  readonly challenge: DeviceSessionChallengeV1
}, secrets: LocalDeviceSecretStoreV1): Promise<DeviceSessionProofV1> {
  const identity = validateDeviceIdentity(input.identity)
  if (!secretReferencePattern.test(input.privateKeyRef)) throw new Error('device proof secret reference is invalid')
  if (input.challenge.schemaVersion !== 1 || input.challenge.tenantId !== identity.tenantId || input.challenge.userId !== identity.userId || input.challenge.deviceId !== identity.deviceId) throw new Error('device challenge is outside the enrolled identity scope')
  const secret = await secrets.get(input.privateKeyRef)
  if (!secret) throw new Error('device private key is unavailable')
  const privateBytes = Buffer.from(secret)
  try {
    const privateKey = createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' })
    const derivedPublic = encodePublicKey(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer)
    if (derivedPublic !== identity.publicKey) throw new Error('device private key does not match enrolled public identity')
    const signature = sign(null, proofPayload(input.challenge.nonce), privateKey).toString('base64url')
    return Object.freeze({ schemaVersion: 1, challengeId: input.challenge.challengeId, deviceId: identity.deviceId, keyId: keyId(identity.publicKey), algorithm: 'ed25519', signature })
  } finally { privateBytes.fill(0); secret.fill(0) }
}

/** Server-side verifier for the public key already owned by the tenant device repository. */
export class NodeEd25519DeviceProofVerifierV1 implements DeviceProofVerifierV1 {
  async verify(input: { readonly publicKey: string; readonly algorithm: 'ed25519'; readonly challenge: string; readonly signature: string }): Promise<boolean> {
    if (input.algorithm !== 'ed25519' || !input.publicKey.startsWith(publicKeyPrefix) || !input.signature || !input.challenge) return false
    try {
      const publicKey = createPublicKey({ key: Buffer.from(input.publicKey.slice(publicKeyPrefix.length), 'base64url'), format: 'der', type: 'spki' })
      return verify(null, proofPayload(input.challenge), publicKey, Buffer.from(input.signature, 'base64url'))
    } catch { return false }
  }
}

function encodePublicKey(value: Buffer): string { return `${publicKeyPrefix}${value.toString('base64url')}` }
function keyId(publicKey: string): string { return `device-key.${createHash('sha256').update(publicKey).digest('hex').slice(0, 24)}` }
function proofPayload(nonce: string): Buffer { return Buffer.from(`${proofDomain}${nonce}`, 'utf8') }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }
