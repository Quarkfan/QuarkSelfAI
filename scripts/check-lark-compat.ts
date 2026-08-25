import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LarkCapabilityDiscovery, isVersionAtLeast } from '../src/lark/capabilities.js'
import { ProcessCommandRunner } from '../src/lark/runner.js'

interface Manifest {
  minimumVersion: string
  requiredEventKeys: string[]
}

const manifest = JSON.parse(await readFile(resolve('config/lark-cli-contract.json'), 'utf8')) as Manifest
const discovery = new LarkCapabilityDiscovery(new ProcessCommandRunner())
const report = await discovery.inspect(manifest.requiredEventKeys)
const versionCompatible = isVersionAtLeast(report.cliVersion, manifest.minimumVersion)
const summary = {
  minimumVersion: manifest.minimumVersion,
  cliVersion: report.cliVersion,
  compatible: report.compatible && versionCompatible,
  versionCompatible,
  fingerprint: report.fingerprint,
  availableEventKeyCount: report.availableEventKeys.length,
  requiredEventKeys: manifest.requiredEventKeys,
  missingEventKeys: report.missingEventKeys,
  checkedAt: report.checkedAt,
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (!summary.compatible) process.exitCode = 1
