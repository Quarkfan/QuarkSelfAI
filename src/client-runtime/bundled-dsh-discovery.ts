import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface BundledDshReportV1 {
  readonly schemaVersion: 1
  readonly executorId: 'dsh'
  readonly installation: 'detected' | 'package-drift' | 'not-detected'
  readonly version: string | null
  readonly inferenceConfigured: boolean
  readonly authentication: 'ready' | 'required'
  readonly protocolVersions: readonly string[]
  readonly capabilities: readonly string[]
}

const closure = ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-tools'] as const

/** Reads manifests and configuration presence only; it never reads or emits secret values. */
export async function discoverBundledDsh(projectRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<BundledDshReportV1> {
  const rootPackage = await json(resolve(projectRoot, 'package.json'))
  const baseline = await json(resolve(projectRoot, 'config/dsh-baseline.json'))
  const version = typeof baseline.version === 'string' ? baseline.version : null
  const dependencies = rootPackage.dependencies as Record<string, unknown> | undefined
  if (!version || !dependencies) return report('not-detected', null, false)
  const versions = await Promise.all(closure.map(async name => {
    try { const manifest = await json(resolve(projectRoot, 'node_modules', name, 'package.json')); return manifest.version }
    catch { return null }
  }))
  const detected = closure.every((name, index) => dependencies[name] === version && versions[index] === version)
  const anyPresent = versions.some(Boolean)
  const inferenceConfigured = Boolean(env.QUARK_INFERENCE_BASE_URL?.trim() && env.QUARK_INFERENCE_API_KEY?.trim())
  return report(detected ? 'detected' : anyPresent ? 'package-drift' : 'not-detected', detected ? version : null, inferenceConfigured)
}

function report(installation: BundledDshReportV1['installation'], version: string | null, inferenceConfigured: boolean): BundledDshReportV1 {
  const ready = installation === 'detected' && inferenceConfigured
  return Object.freeze({ schemaVersion: 1, executorId: 'dsh', installation, version, inferenceConfigured, authentication: ready ? 'ready' : 'required', protocolVersions: ready ? Object.freeze(['envelope.v1']) : Object.freeze([]), capabilities: ready ? Object.freeze(['agent.execute', 'tool.execute']) : Object.freeze([]) })
}

async function json(path: string): Promise<Record<string, unknown>> { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> }
