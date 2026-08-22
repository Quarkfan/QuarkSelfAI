import { createHash } from 'node:crypto'
import { isRecord } from './json.js'
import { runJson, type CommandRunner } from './runner.js'

export interface EventCapability {
  readonly key: string
  readonly authTypes: readonly string[]
  readonly scopes: readonly string[]
  readonly schema: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

export interface CompatibilityReport {
  readonly cliVersion: string
  readonly compatible: boolean
  readonly fingerprint: string
  readonly availableEventKeys: readonly string[]
  readonly missingEventKeys: readonly string[]
  readonly capabilities: Readonly<Record<string, EventCapability>>
  readonly checkedAt: string
}

export function isVersionAtLeast(actual: string, minimum: string): boolean {
  const parse = (version: string) => version.split(/[.+-]/, 3).map((part) => Number.parseInt(part, 10))
  const left = parse(actual)
  const right = parse(minimum)
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    if (a !== b) return a > b
  }
  return true
}

function eventKeyOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.key === 'string' ? value.key : undefined
}

export class LarkCapabilityDiscovery {
  constructor(
    private readonly runner: CommandRunner,
    private readonly executable = 'lark-cli',
  ) {}

  async version(signal?: AbortSignal): Promise<string> {
    const output = await this.runner.run(this.executable, ['--version'], signal)
    if (output.exitCode !== 0) throw new Error(`lark-cli --version exited ${output.exitCode}`)
    const match = output.stdout.match(/(?:version\s+)?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)
    if (!match?.[1]) throw new Error(`cannot parse lark-cli version: ${output.stdout.trim()}`)
    return match[1]
  }

  async inspect(requiredEventKeys: readonly string[], signal?: AbortSignal): Promise<CompatibilityReport> {
    const [cliVersion, listed] = await Promise.all([
      this.version(signal),
      runJson(this.runner, this.executable, ['event', 'list', '--json'], signal),
    ])
    if (!Array.isArray(listed)) throw new Error('lark-cli event list returned a non-array payload')
    const availableEventKeys = listed.map(eventKeyOf).filter((key): key is string => key !== undefined).sort()
    const available = new Set(availableEventKeys)
    const missingEventKeys = requiredEventKeys.filter((key) => !available.has(key))
    const found = requiredEventKeys.filter((key) => available.has(key))
    const definitions = await Promise.all(found.map(async (key) => {
      const value = await runJson(this.runner, this.executable, ['event', 'schema', key, '--json'], signal)
      if (!isRecord(value)) throw new Error(`lark-cli schema for ${key} returned a non-object payload`)
      const resolved = isRecord(value.resolved_output_schema) ? value.resolved_output_schema : {}
      const capability: EventCapability = {
        key,
        authTypes: Array.isArray(value.auth_types) ? value.auth_types.filter((item): item is string => typeof item === 'string') : [],
        scopes: Array.isArray(value.scopes) ? value.scopes.filter((item): item is string => typeof item === 'string') : [],
        schema: resolved,
        raw: value,
      }
      return [key, capability] as const
    }))
    const capabilities = Object.fromEntries(definitions)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ cliVersion, availableEventKeys, capabilities }))
      .digest('hex')
    return {
      cliVersion,
      compatible: missingEventKeys.length === 0,
      fingerprint,
      availableEventKeys,
      missingEventKeys,
      capabilities,
      checkedAt: new Date().toISOString(),
    }
  }
}
