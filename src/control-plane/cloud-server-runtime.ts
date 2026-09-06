import type { CloudControlPlaneCompositionDependenciesV1 } from './cloud-composition.js'
import { openCloudSshIpcBridgeV1, type CloudSshIpcBridgeV1 } from './cloud-ssh-ipc.js'
import { PreparedCloudTransportHostV1 } from './cloud-transport-host.js'
import { openTlsCloudEdgeV1, type TlsCloudEdgeV1 } from './node-tls-edge.js'

export interface PreparedCloudServerRuntimeConfigV1 { readonly schemaVersion: 1; readonly host: unknown; readonly tls: unknown; readonly sshIpc: unknown; readonly singleProvider: true; readonly externalEffectsEnabled: false }
export interface PreparedCloudServerRuntimeV1 { readonly tls: TlsCloudEdgeV1; readonly sshIpc: CloudSshIpcBridgeV1; readonly providerOwnership: 'single-shared-host'; close(): Promise<void> }

/** Opens both network edges around one provider host. Nothing invokes this runtime automatically. */
export async function openPreparedCloudServerRuntimeV1(value: unknown, credentials: { readonly key: Buffer; readonly cert: Buffer }, dependencies: CloudControlPlaneCompositionDependenciesV1): Promise<PreparedCloudServerRuntimeV1> {
  const config = validate(value); let host: PreparedCloudTransportHostV1 | undefined; let sshIpc: CloudSshIpcBridgeV1 | undefined; let tls: TlsCloudEdgeV1 | undefined
  try {
    host = await PreparedCloudTransportHostV1.open(config.host, dependencies)
    sshIpc = await openCloudSshIpcBridgeV1(config.sshIpc, host)
    tls = await openTlsCloudEdgeV1(config.tls, credentials, { handle: request => host!.handleHttp(request) })
    let closed = false
    return Object.freeze({ tls, sshIpc, providerOwnership: 'single-shared-host', close: async () => {
      if (closed) return; closed = true
      const errors: unknown[] = []
      for (const item of [tls!, sshIpc!, host!]) { try { await item.close() } catch (error) { errors.push(error) } }
      if (errors.length) throw new AggregateError(errors, 'cloud server runtime close failed')
    } })
  } catch (error) {
    for (const item of [tls, sshIpc, host]) { if (item) { try { await item.close() } catch {} } }
    throw error
  }
}

function validate(value: unknown): PreparedCloudServerRuntimeConfigV1 {
  if (!isRecord(value)) throw new Error('cloud server runtime config is invalid')
  const keys = ['schemaVersion', 'host', 'tls', 'sshIpc', 'singleProvider', 'externalEffectsEnabled']
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || !isRecord(value.host) || !isRecord(value.tls) || !isRecord(value.sshIpc) || value.singleProvider !== true || value.externalEffectsEnabled !== false) throw new Error('cloud server runtime must remain single-provider and effects-off')
  return value as unknown as PreparedCloudServerRuntimeConfigV1
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
