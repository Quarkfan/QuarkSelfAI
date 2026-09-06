import type { DeviceIdentityV1, ExecutorCapabilityReportV1, PlanSignatureVerifierV1, SignedExecutionPlanV1 } from './contracts.js'
import { contentDigest, validateExecutionEnvelope } from '../capability-platform/validation.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const unsafeEvidencePattern = /(?:^|[\\/])Users[\\/]|(?:token|secret|password|private[_-]?key)\s*[:=]/i

function validTime(value: string, label: string): number {
  const result = Date.parse(value)
  if (Number.isNaN(result)) throw new Error(`${label} must be an ISO timestamp`)
  return result
}

function validId(value: string, label: string): void {
  if (!idPattern.test(value)) throw new Error(`${label} is invalid`)
}

export function validateDeviceIdentity(value: DeviceIdentityV1): DeviceIdentityV1 {
  if (value.schemaVersion !== 1 || value.keyAlgorithm !== 'ed25519') throw new Error('device identity contract is unsupported')
  for (const [label, id] of [['tenantId', value.tenantId], ['userId', value.userId], ['deviceId', value.deviceId]] as const) validId(id, label)
  if (!value.publicKey || unsafeEvidencePattern.test(value.publicKey)) throw new Error('device identity public key is invalid')
  validTime(value.createdAt, 'device identity createdAt')
  if (!value.attestation.reference || unsafeEvidencePattern.test(value.attestation.reference)) throw new Error('device attestation must be an opaque public reference')
  return value
}

export function validateExecutorCapabilityReport(value: ExecutorCapabilityReportV1): ExecutorCapabilityReportV1 {
  if (value.schemaVersion !== 1) throw new Error('executor report schema is unsupported')
  validId(value.deviceId, 'executor report deviceId')
  validId(value.executorId, 'executor report executorId')
  if (!['ready', 'not-installed', 'auth-required', 'version-unsupported', 'unavailable'].includes(value.availability)) throw new Error('executor availability is invalid')
  const strings = [value.version ?? '', ...value.protocolVersions, ...value.capabilities, ...value.constraints]
  if (strings.some(item => unsafeEvidencePattern.test(item))) throw new Error('executor report contains a local path or secret-shaped value')
  if (new Set(value.capabilities).size !== value.capabilities.length || new Set(value.protocolVersions).size !== value.protocolVersions.length) throw new Error('executor report capabilities must be unique')
  if (value.availability === 'ready' && (!value.version || !value.protocolVersions.length)) throw new Error('ready executor report requires a version and protocol')
  if (validTime(value.expiresAt, 'executor report expiresAt') <= validTime(value.discoveredAt, 'executor report discoveredAt')) throw new Error('executor report must expire after discovery')
  return value
}

export function executionEnvelopePayloadDigest(value: SignedExecutionPlanV1['envelope']): string {
  const envelope = validateExecutionEnvelope(value)
  const { plan: _signatureMetadata, ...payload } = envelope
  return contentDigest(payload)
}

export async function verifySignedExecutionPlan(value: SignedExecutionPlanV1, verifier: PlanSignatureVerifierV1, now = new Date()): Promise<SignedExecutionPlanV1> {
  if (value.schemaVersion !== 1 || value.algorithm !== 'ed25519') throw new Error('signed plan contract is unsupported')
  validId(value.planId, 'signed plan id')
  if (!digestPattern.test(value.payloadDigest)) throw new Error('signed plan payload digest is invalid')
  const issuedAt = validTime(value.issuedAt, 'signed plan issuedAt')
  const expiresAt = validTime(value.expiresAt, 'signed plan expiresAt')
  if (issuedAt > now.getTime() || expiresAt <= now.getTime()) throw new Error('signed plan is not currently valid')
  const envelope = validateExecutionEnvelope(value.envelope)
  if (executionEnvelopePayloadDigest(envelope) !== value.payloadDigest || envelope.plan.digest !== value.payloadDigest) throw new Error('signed plan payload digest does not match its envelope')
  if (envelope.plan.keyId !== value.keyId || envelope.plan.signature !== value.signature) throw new Error('signed plan metadata does not match its envelope')
  if (!await verifier.verify({ keyId: value.keyId, algorithm: value.algorithm, payloadDigest: value.payloadDigest, signature: value.signature })) throw new Error('signed plan signature is invalid')
  return value
}
