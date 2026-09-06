import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export interface BundledDshReportV1 {
  readonly schemaVersion: 1
  readonly executorId: 'dsh'
  readonly installation: 'detected' | 'package-drift' | 'not-detected'
  readonly version: string | null
  readonly hostEntrypoint: 'detected' | 'missing' | 'unsafe'
  readonly inferenceConfigured: boolean
  readonly authentication: 'ready' | 'required'
  readonly protocolVersions: readonly string[]
  readonly capabilities: readonly string[]
}

/** Reads manifests and configuration presence only; it never reads or emits secret values. */
export async function discoverBundledDsh(projectRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<BundledDshReportV1> {
  const rootPackage = await json(resolve(projectRoot, 'package.json'))
  const baseline = await json(resolve(projectRoot, 'config/dsh-baseline.json'))
  const version = typeof baseline.version === 'string' ? baseline.version : null
  const dependencies = rootPackage.dependencies as Record<string, unknown> | undefined
  const runtimePackages = baseline.fallbackRuntimePackages as Record<string, unknown> | undefined
  if (!version || !dependencies || !runtimePackages || !Object.keys(runtimePackages).length) return report('not-detected', null, 'missing', false)
  const packageNames = Object.keys(runtimePackages).sort()
  const versions = await Promise.all(packageNames.map(async name => {
    try { const manifest = await json(resolve(projectRoot, 'node_modules', name, 'package.json')); return manifest.version }
    catch { return null }
  }))
  const detected = packageNames.every((name, index) => typeof runtimePackages[name] === 'string' && dependencies[name] === runtimePackages[name] && versions[index] === runtimePackages[name])
  const anyPresent = versions.some(Boolean)
  const hostEntrypoint = detected ? await inspectHostEntrypoint(projectRoot) : 'missing'
  const inferenceConfigured = Boolean(env.QUARK_INFERENCE_BASE_URL?.trim() && env.QUARK_INFERENCE_API_KEY?.trim())
  return report(detected ? 'detected' : anyPresent ? 'package-drift' : 'not-detected', detected ? version : null, hostEntrypoint, inferenceConfigured)
}

function report(installation: BundledDshReportV1['installation'], version: string | null, hostEntrypoint: BundledDshReportV1['hostEntrypoint'], inferenceConfigured: boolean): BundledDshReportV1 {
  const ready = installation === 'detected' && hostEntrypoint === 'detected' && inferenceConfigured
  return Object.freeze({ schemaVersion: 1, executorId: 'dsh', installation, version, hostEntrypoint, inferenceConfigured, authentication: ready ? 'ready' : 'required', protocolVersions: ready ? Object.freeze(['envelope.v1']) : Object.freeze([]), capabilities: ready ? Object.freeze(['agent.execute']) : Object.freeze([]) })
}

async function inspectHostEntrypoint(projectRoot: string): Promise<BundledDshReportV1['hostEntrypoint']> {
  try {
    const packageRoot = resolve(projectRoot, 'node_modules/@deepseek-ai/dsh')
    const manifest = await json(resolve(packageRoot, 'package.json'))
    const bin = manifest.bin as Record<string, unknown> | undefined
    const relativeBin = bin?.dsh
    if (typeof relativeBin !== 'string' || !relativeBin || isAbsolute(relativeBin)) return 'unsafe'
    const entrypoint = resolve(packageRoot, relativeBin)
    if (relative(packageRoot, entrypoint).startsWith('..') || dirname(entrypoint) === projectRoot) return 'unsafe'
    const [canonicalPackageRoot, canonical, status] = await Promise.all([realpath(packageRoot), realpath(entrypoint), lstat(entrypoint)])
    if (relative(canonicalPackageRoot, canonical).startsWith('..') || !status.isFile() || status.isSymbolicLink()) return 'unsafe'
    return 'detected'
  } catch {
    return 'missing'
  }
}

async function json(path: string): Promise<Record<string, unknown>> { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> }
