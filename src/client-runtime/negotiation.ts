import type { ExecutorCapabilityReportV1, ExecutorRequirementV1, ExecutorSelectionV1 } from './contracts.js'

export function negotiateExecutor(requirement: ExecutorRequirementV1, reports: readonly ExecutorCapabilityReportV1[], now = new Date()): ExecutorSelectionV1 {
  const byId = new Map(reports.map(report => [report.executorId, report]))
  const order = [...requirement.preferredExecutors, ...requirement.allowedExecutors.filter(id => !requirement.preferredExecutors.includes(id))]
  for (const executorId of order) {
    if (!requirement.allowedExecutors.includes(executorId)) continue
    const report = byId.get(executorId)
    if (!report || report.availability !== 'ready' || Date.parse(report.expiresAt) <= now.getTime()) continue
    const protocol = requirement.protocolVersions.find(candidate => report.protocolVersions.includes(candidate))
    if (!protocol || requirement.capabilities.some(capability => !report.capabilities.includes(capability))) continue
    return {
      executorId,
      reportExpiresAt: report.expiresAt,
      matchedProtocolVersion: protocol,
      matchedCapabilities: [...requirement.capabilities],
      reason: requirement.preferredExecutors.includes(executorId) ? 'preferred-ready' : 'fallback-ready',
    }
  }
  throw new Error('no eligible executor satisfies the signed plan requirements')
}
