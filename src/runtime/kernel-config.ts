import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface AssistantKernelConfig {
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

export interface AssistantKernelConfigDefaults {
  readonly kernelProfile?: string
}

/** Stable DSH kernel configuration. Product features and migration selectors compose around this value. */
export function loadAssistantKernelConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  defaults: AssistantKernelConfigDefaults = {},
): AssistantKernelConfig {
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
    kernel: kernelMode === 'off'
      ? { mode: 'off' }
      : { mode: 'dsh', ...dshLaunch, home, profile },
  }
}
