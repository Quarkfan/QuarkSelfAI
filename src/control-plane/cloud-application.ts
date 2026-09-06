import type { ArtifactVerificationReportV1, DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseAcknowledgementV1, DeviceTaskLeaseV1 } from '../client-runtime/contracts.js'
import type { ManifestPublicationCandidateV1 } from '../capability-platform/artifact-candidates.js'
import type { AgentBlueprintV1 } from '../capability-platform/blueprint.js'
import type { CapabilityCatalogRecordV1, AgentDraftRecordV1, AgentTestReleaseV1, DeviceRecordV1, DeviceSessionServerPortV1, PersistentAgentStudioPortV1, PersistentCapabilityRegistryPortV1, RedactedResultV1, TenantContextV1, TenantDevicePortV1 } from './contracts.js'

const sessionPattern = /^session:[a-z0-9][a-z0-9._:-]{0,127}$/

export interface CloudIdentityPortV1 {
  /** Resolves an opaque adapter-owned session reference; raw credentials must not cross this port. */
  resolveSession(sessionReference: string): Promise<TenantContextV1 | undefined>
}

/** Authenticated application boundary. It has no HTTP listener, cookie/token parser, scheduler, dispatcher or runtime mount. */
export class InactiveCloudControlPlaneApplicationV1 {
  constructor(
    private readonly identity: CloudIdentityPortV1,
    private readonly capabilities: PersistentCapabilityRegistryPortV1,
    private readonly studio: PersistentAgentStudioPortV1,
    private readonly devices: TenantDevicePortV1,
    private readonly deviceSessions?: DeviceSessionServerPortV1,
  ) {}

  async listCapabilities(sessionReference: string): Promise<readonly CapabilityCatalogRecordV1[]> {
    return await this.capabilities.listVisible(await this.#context(sessionReference))
  }

  async registerCapability(sessionReference: string, input: { readonly candidate: ManifestPublicationCandidateV1; readonly evidence: ArtifactVerificationReportV1; readonly visibility: 'private' | 'tenant' }, now?: Date): Promise<CapabilityCatalogRecordV1> {
    return await this.capabilities.registerInactive(await this.#context(sessionReference), input, now)
  }

  async listAgentDrafts(sessionReference: string): Promise<readonly AgentDraftRecordV1[]> {
    return await this.studio.listDrafts(await this.#context(sessionReference))
  }

  async saveAgentDraft(sessionReference: string, input: { readonly draftId: string; readonly blueprint: AgentBlueprintV1; readonly expectedRevision: number }, now?: Date): Promise<AgentDraftRecordV1> {
    return await this.studio.saveDraft(await this.#context(sessionReference), input, now)
  }

  async publishAgentTest(sessionReference: string, input: { readonly draftId: string; readonly expectedRevision: number }, now?: Date): Promise<AgentTestReleaseV1> {
    return await this.studio.publishTest(await this.#context(sessionReference), input, now)
  }

  async registerDevice(sessionReference: string, input: { readonly deviceId: string; readonly publicKey: string }, now?: Date): Promise<DeviceRecordV1> {
    return await this.devices.registerDevice(await this.#context(sessionReference), input, now)
  }

  async listDevices(sessionReference: string): Promise<readonly DeviceRecordV1[]> {
    return await this.devices.listDevices(await this.#context(sessionReference))
  }

  async issueDeviceChallenge(sessionReference: string, deviceId: string, now?: Date): Promise<DeviceSessionChallengeV1> {
    const context = await this.#context(sessionReference)
    return await this.#sessions().issueChallenge({ tenantId: context.tenantId, userId: context.userId, deviceId }, now)
  }
  async issueDeviceReconnectChallenge(input: { readonly tenantId: string; readonly userId: string; readonly deviceId: string }, now?: Date): Promise<DeviceSessionChallengeV1> {
    return await this.#sessions().issueChallenge(input, now)
  }
  async openDeviceSession(proof: DeviceSessionProofV1, now?: Date): Promise<DeviceSessionV1> { return await this.#sessions().openSession(proof, now) }
  async pollDeviceSession(sessionId: string, now?: Date): Promise<DeviceTaskLeaseV1 | null> { return await this.#sessions().poll(sessionId, now) }
  async acknowledgeDeviceLease(sessionId: string, input: { readonly leaseToken: string; readonly taskId: string }, now?: Date): Promise<DeviceTaskLeaseAcknowledgementV1> { return await this.#sessions().acknowledge(sessionId, input, now) }
  async submitDeviceResult(sessionId: string, input: Omit<RedactedResultV1, 'tenantId' | 'userId'>, now?: Date): Promise<RedactedResultV1> { return await this.#sessions().submitResult(sessionId, input, now) }

  async #context(sessionReference: string): Promise<TenantContextV1> {
    if (!sessionPattern.test(sessionReference)) throw new Error('cloud session reference is invalid')
    const context = await this.identity.resolveSession(sessionReference)
    if (!context) throw new Error('cloud session is not authenticated')
    return deepFreeze(structuredClone(context))
  }
  #sessions(): DeviceSessionServerPortV1 { if (!this.deviceSessions) throw new Error('device session provider is unavailable'); return this.deviceSessions }
}

function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }
