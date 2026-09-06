import type { ClientRuntimeSnapshotV1 } from './contracts.js'

/** Safe bootstrap state. No connector, probe, installer, consumer or effect is started. */
export function createInactiveClientSnapshot(deviceId: string | null = null): ClientRuntimeSnapshotV1 {
  return Object.freeze({
    deviceId,
    connection: deviceId ? 'disconnected' : 'unenrolled',
    registeredCapabilities: 0,
    activeCapabilities: 0,
    ownedConsumers: 0,
    ownedProviders: 0,
    ownedSchedulers: 0,
    externalWritesEnabled: false,
  })
}
