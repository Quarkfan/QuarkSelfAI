import type { ExecutionConfig } from '../execution/config.js'

export interface ConsoleServerConfig {
  readonly execution: ExecutionConfig
  readonly web: {
    readonly host: string
    readonly port: number
    readonly consoleToken?: string
    readonly secureCookie: boolean
    readonly dshUrl?: string
  }
  readonly controlPlane: { readonly token?: string }
}

export function loadConsoleConfig(
  env: NodeJS.ProcessEnv = process.env,
  execution: ExecutionConfig,
  dshEnabled = true,
): ConsoleServerConfig {
  const host = env.WEB_HOST ?? '127.0.0.1'
  const consoleToken = env.CONSOLE_TOKEN?.trim() || undefined
  if (!isLoopback(host) && !consoleToken) {
    throw new Error('CONSOLE_TOKEN is required when WEB_HOST is not loopback')
  }
  const controlPlaneToken = env.CONTROL_PLANE_TOKEN?.trim() || undefined
  return {
    execution,
    web: {
      host,
      port: port(env.WEB_PORT, 'WEB_PORT', 3210),
      ...(consoleToken ? { consoleToken } : {}),
      secureCookie: boolean(env.CONSOLE_SECURE_COOKIE),
      ...(dshEnabled ? { dshUrl: `http://127.0.0.1:${port(env.DSH_WEB_PORT, 'DSH_WEB_PORT', 3211)}` } : {}),
    },
    controlPlane: { ...(controlPlaneToken ? { token: controlPlaneToken } : {}) },
  }
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
