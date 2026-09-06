import type { DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseAcknowledgementV1, DeviceTaskLeaseV1 } from './contracts.js'

export interface DeviceRedactedResultV1 {
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly taskId: string
  readonly planId: string
  readonly outcome: 'succeeded' | 'failed' | 'cancelled'
  readonly summaryCode: string
  readonly artifactDigests: readonly string[]
  readonly completedAt: string
}

export type DeviceProtocolPayloadV1 =
  | { readonly kind: 'client.hello'; readonly protocol: 'quark-device-sync.v1'; readonly transport: 'direct-tls' | 'ssh-subsystem'; readonly executorReportDigests: readonly string[] }
  | { readonly kind: 'server.challenge'; readonly challenge: DeviceSessionChallengeV1 }
  | { readonly kind: 'client.proof'; readonly proof: DeviceSessionProofV1 }
  | { readonly kind: 'server.session'; readonly session: DeviceSessionV1 }
  | { readonly kind: 'client.poll'; readonly sessionId: string }
  | { readonly kind: 'server.lease'; readonly lease: DeviceTaskLeaseV1 | null }
  | { readonly kind: 'client.ack-request'; readonly sessionId: string; readonly leaseToken: string; readonly taskId: string }
  | { readonly kind: 'server.ack'; readonly acknowledgement: DeviceTaskLeaseAcknowledgementV1 }
  | { readonly kind: 'client.result-submit'; readonly sessionId: string; readonly result: Omit<DeviceRedactedResultV1, 'tenantId' | 'userId'> }
  | { readonly kind: 'server.result'; readonly result: DeviceRedactedResultV1 }
  | { readonly kind: 'client.heartbeat'; readonly sessionId: string }
  | { readonly kind: 'server.error'; readonly code: 'request-rejected' | 'temporarily-unavailable' }

export interface DeviceProtocolMessageV1 {
  readonly schemaVersion: 1
  readonly frameId: string
  readonly causationId: string | null
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly sentAt: string
  readonly payload: DeviceProtocolPayloadV1
}
