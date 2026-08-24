import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export interface AssistantApplicationConfig {
  readonly execution:
    | { readonly mode: 'local'; readonly workspaceRoots: readonly string[] }
    | { readonly mode: 'remote'; readonly workspaceRoots: readonly [] }
  readonly web: {
    readonly host: string
    readonly port: number
    readonly consoleToken?: string
    readonly secureCookie: boolean
    readonly dshUrl?: string
  }
  readonly controlPlane: { readonly token?: string }
  readonly kernel:
    | { readonly mode: 'off' }
    | {
        readonly mode: 'dsh'
        readonly command: string
        readonly args: readonly string[]
        readonly cwd: string
        readonly home: string
        readonly profile: string
      }
}

export interface AssistantApplicationConfigDefaults {
  readonly kernelProfile?: string
}

function port(value: string | undefined, name: string, fallback: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer from 1 to 65535, received ${String(value)}`)
  }
  return parsed
}

function boolean(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function workspaceRoots(value: string | undefined, cwd: string): readonly string[] {
  if (!value?.trim()) return [resolve(cwd)]
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('ASSISTANT_WORKSPACE_ROOTS must be a JSON array of absolute paths')
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== 'string' || !item.trim() || !isAbsolute(item))) {
    throw new Error('ASSISTANT_WORKSPACE_ROOTS must be a non-empty JSON array of absolute paths')
  }
  return [...new Set(parsed.map((item) => resolve(item as string)))]
}

/** Stable process configuration. Feature and migration selectors compose around this value. */
export function loadAssistantApplicationConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  defaults: AssistantApplicationConfigDefaults = {},
): AssistantApplicationConfig {
  const host = env.WEB_HOST ?? '127.0.0.1'
  const consoleToken = env.CONSOLE_TOKEN?.trim() || undefined
  const controlPlaneToken = env.CONTROL_PLANE_TOKEN?.trim() || undefined
  const dshWebPort = port(env.DSH_WEB_PORT, 'DSH_WEB_PORT', 3211)
  if (!isLoopback(host) && !consoleToken) {
    throw new Error('CONSOLE_TOKEN is required when WEB_HOST is not loopback')
  }
  const executionMode = env.ASSISTANT_EXECUTION_MODE ?? 'local'
  if (executionMode !== 'local' && executionMode !== 'remote') {
    throw new Error(`ASSISTANT_EXECUTION_MODE must be local or remote, received ${executionMode}`)
  }
  const kernelMode = env.ASSISTANT_KERNEL ?? 'dsh'
  if (kernelMode !== 'dsh' && kernelMode !== 'off') {
    throw new Error(`ASSISTANT_KERNEL must be dsh or off, received ${kernelMode}`)
  }
  const profile = env.DSH_PROFILE?.trim() || defaults.kernelProfile?.trim() || 'assistant'
  const dshArgs = ['--profile', profile, '--no-open']
  const home = resolve(cwd, env.DSH_HOME?.trim() || 'var/dsh')
  const installed = resolve(cwd, 'node_modules/.bin/dsh')
  const checkout = resolve(cwd, env.DSH_CHECKOUT?.trim() || '../deepseek-harness')
  const checkoutEntry = resolve(checkout, 'apps/cli/lib/bin.js')
  const explicit = env.DSH_EXECUTABLE?.trim()
  const dshLaunch = explicit
    ? { command: explicit, args: dshArgs, cwd }
    : existsSync(installed)
      ? { command: installed, args: dshArgs, cwd }
      : existsSync(checkoutEntry)
        ? { command: process.execPath, args: [checkoutEntry, ...dshArgs], cwd }
        : { command: 'dsh', args: dshArgs, cwd }
  return {
    execution: executionMode === 'local'
      ? { mode: 'local', workspaceRoots: workspaceRoots(env.ASSISTANT_WORKSPACE_ROOTS, cwd) }
      : { mode: 'remote', workspaceRoots: [] },
    web: {
      host,
      port: port(env.WEB_PORT, 'WEB_PORT', 3210),
      ...(consoleToken ? { consoleToken } : {}),
      secureCookie: boolean(env.CONSOLE_SECURE_COOKIE),
      ...(kernelMode === 'dsh' ? { dshUrl: `http://127.0.0.1:${dshWebPort}` } : {}),
    },
    controlPlane: { ...(controlPlaneToken ? { token: controlPlaneToken } : {}) },
    kernel: kernelMode === 'off'
      ? { mode: 'off' }
      : { mode: 'dsh', ...dshLaunch, home, profile },
  }
}
