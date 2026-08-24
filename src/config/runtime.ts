import { resolve } from 'node:path'
import { loadAssistantApplicationConfig, type AssistantApplicationConfig } from '../bootstrap/config.js'
import { loadStorageConfig, type StorageConfig } from '../storage/config.js'

/** Temporary top-level selector while the compatibility host owns production traffic. */
export interface RuntimeConfig extends AssistantApplicationConfig {
  readonly storage: StorageConfig
  readonly runtime:
    | { readonly mode: 'control-only' }
    | { readonly mode: 'compat'; readonly configPath: string }
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): RuntimeConfig {
  const application = loadAssistantApplicationConfig(env, cwd, { kernelProfile: 'feishu-assistant' })
  const runtimeMode = env.ASSISTANT_RUNTIME ?? 'control-only'
  if (runtimeMode !== 'control-only' && runtimeMode !== 'compat') {
    throw new Error(`ASSISTANT_RUNTIME must be control-only or compat, received ${runtimeMode}`)
  }
  const compatConfigPath = env.COMPAT_CONFIG_PATH?.trim()
  if (runtimeMode === 'compat' && !compatConfigPath) {
    throw new Error('COMPAT_CONFIG_PATH is required when ASSISTANT_RUNTIME=compat')
  }
  if (runtimeMode === 'compat' && env.TAKEOVER_CONFIRMED !== 'true') {
    throw new Error('TAKEOVER_CONFIRMED=true is required to start the production compatibility runtime')
  }
  if (runtimeMode === 'compat' && !application.controlPlane.token) {
    throw new Error('CONTROL_PLANE_TOKEN is required when ASSISTANT_RUNTIME=compat')
  }
  if (runtimeMode === 'compat' && application.execution.mode !== 'local') {
    throw new Error('ASSISTANT_RUNTIME=compat requires ASSISTANT_EXECUTION_MODE=local')
  }
  if (runtimeMode === 'compat' && application.kernel.mode === 'off') {
    throw new Error('ASSISTANT_RUNTIME=compat requires ASSISTANT_KERNEL=dsh')
  }
  return {
    ...application,
    storage: loadStorageConfig(env, cwd),
    runtime: runtimeMode === 'compat'
      ? { mode: runtimeMode, configPath: resolve(cwd, compatConfigPath ?? '') }
      : { mode: 'control-only' },
  }
}
