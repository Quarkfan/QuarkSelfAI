import type { CloudHttpRequestV1, CloudHttpResponseV1 } from './http-handler.js'
import { InactiveCloudControlPlaneCompositionV1, type CloudControlPlaneCompositionDependenciesV1 } from './cloud-composition.js'
import { handleSshSubsystemFrameV1 } from '../client-runtime/ssh-subsystem-server.js'

export interface PreparedCloudTransportHostConfigV1 {
  readonly schemaVersion: 1
  readonly composition: unknown
  readonly directTls: 'prepared-inactive'
  readonly sshSubsystem: 'prepared-inactive'
  readonly singleProvider: true
  readonly activationAllowed: false
}

/** One unmounted owner for both transport adapters. It opens no socket and starts no subsystem process. */
export class PreparedCloudTransportHostV1 {
  private constructor(private readonly composition: InactiveCloudControlPlaneCompositionV1) {}

  static async open(value: unknown, dependencies: CloudControlPlaneCompositionDependenciesV1): Promise<PreparedCloudTransportHostV1> {
    if (!isRecord(value)) throw new Error('cloud transport host config is invalid')
    const keys = ['schemaVersion', 'composition', 'directTls', 'sshSubsystem', 'singleProvider', 'activationAllowed']
    if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || value.directTls !== 'prepared-inactive' || value.sshSubsystem !== 'prepared-inactive' || value.singleProvider !== true || value.activationAllowed !== false) throw new Error('cloud transport host must remain single-provider and inactive')
    return new PreparedCloudTransportHostV1(await InactiveCloudControlPlaneCompositionV1.open(value.composition, dependencies))
  }

  async handleHttp(request: CloudHttpRequestV1): Promise<CloudHttpResponseV1> { return await this.composition.http.handle(request) }
  async handleSshFrame(frame: Buffer, now?: Date): Promise<Buffer> { return await handleSshSubsystemFrameV1(this.composition.sessions, frame, now) }
  async close(): Promise<void> { await this.composition.close() }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
