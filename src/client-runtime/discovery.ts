import type { ExecutorCapabilityReportV1, ExecutorDiscoveryProbeV1 } from './contracts.js'
import { validateExecutorCapabilityReport } from './validation.js'

const safeExecutorId = /^[a-z0-9][a-z0-9.-]{0,63}$/

/** Unmounted discovery coordinator. Probe implementations are supplied by a later, explicitly activated adapter. */
export class InactiveExecutorDiscoveryV1 {
  readonly #probes: readonly ExecutorDiscoveryProbeV1[]

  constructor(probes: readonly ExecutorDiscoveryProbeV1[]) {
    const ids = probes.map(probe => probe.executorId)
    if (ids.some(id => !safeExecutorId.test(id))) throw new Error('executor probe id is invalid')
    if (new Set(ids).size !== ids.length) throw new Error('executor probe ids must be unique')
    this.#probes = [...probes]
  }

  async inspect(deviceId: string, now = new Date()): Promise<readonly ExecutorCapabilityReportV1[]> {
    const reports: ExecutorCapabilityReportV1[] = []
    for (const probe of this.#probes) {
      const report = validateExecutorCapabilityReport(await probe.inspect(deviceId, now))
      if (report.deviceId !== deviceId || report.executorId !== probe.executorId) throw new Error('executor report identity does not match its probe')
      reports.push(report)
    }
    return reports
  }
}
