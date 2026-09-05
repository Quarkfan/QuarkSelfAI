import assert from 'node:assert/strict'
import test from 'node:test'
import { auditCapabilityPlatformDesign } from '../scripts/audit-capability-platform-design.js'

test('covers every current module and every console requirement without activating runtime', async () => {
  const report = await auditCapabilityPlatformDesign(process.cwd())
  assert.equal(report.ok, true, report.blockers.join('\n'))
  assert.equal(report.moduleCatalogCount, 99)
  assert.equal(report.migratedModuleCount, report.moduleCatalogCount)
  assert.equal(report.consoleRequirementCount, 34)
  assert.equal(report.consoleCompleteCount, report.consoleRequirementCount)
  assert.equal(report.consoleCoveragePercent, 100)
  assert.equal(report.runtimeActivationAllowed, false)
  assert.equal(report.runtimeCompositionChangeAllowed, false)
})
