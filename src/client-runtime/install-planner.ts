import type { CapabilityLifecycleSnapshotV1, CapabilityManifestV1 } from '../capability-platform/manifest.js'
import { contentDigest, validateCapabilityManifest } from '../capability-platform/validation.js'
import type { ArtifactVerificationReportV1, InactiveInstallationPlanV1 } from './contracts.js'

export function planInactiveInstallation(manifestInput: unknown, report: ArtifactVerificationReportV1, deviceId: string, now = new Date()): InactiveInstallationPlanV1 {
  const manifest = validateCapabilityManifest(manifestInput)
  if (report.schemaVersion !== 1 || report.decision !== 'verified' || Object.values(report.checks).some(result => result !== 'pass')) throw new Error('artifact verification must pass every supply-chain check')
  if (report.capabilityId !== manifest.id || report.version !== manifest.version || report.artifactDigest !== manifest.source.artifactDigest || report.sourceRevision !== manifest.source.revision) throw new Error('artifact verification identity does not match the manifest')
  if (!deviceId || /[\\/]/.test(deviceId)) throw new Error('installation device id is invalid')
  const install = manifest.lifecycle.install
  if (!install.supported || install.approval !== 'install') throw new Error('capability does not expose an install-approved lifecycle handler')
  return Object.freeze({
    schemaVersion: 1,
    planId: contentDigest({ deviceId, capabilityId: manifest.id, version: manifest.version, artifactDigest: manifest.source.artifactDigest, policyRevision: report.policyRevision }),
    deviceId,
    capabilityId: manifest.id,
    version: manifest.version,
    artifactDigest: manifest.source.artifactDigest,
    isolation: manifest.runtime.isolation,
    lifecycleHandler: install.handlerInterface,
    requiredApproval: 'install',
    targetState: 'installed-inactive',
    loadAllowed: false,
    runAllowed: false,
    externalWritesEnabled: false,
    createdAt: now.toISOString(),
  })
}

export function inactiveLifecycleSnapshot(plan: InactiveInstallationPlanV1, now = new Date()): CapabilityLifecycleSnapshotV1 {
  return Object.freeze({
    capabilityId: plan.capabilityId,
    version: plan.version,
    artifactDigest: plan.artifactDigest,
    deviceId: plan.deviceId,
    installation: 'installed',
    loading: 'unloaded',
    authorization: 'unauthorized',
    execution: 'stopped',
    effects: 'disabled',
    updatedAt: now.toISOString(),
  })
}
