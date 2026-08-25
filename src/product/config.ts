import { loadExecutionConfig } from '../execution/config.js'
import { loadAssistantKernelConfig, type AssistantKernelConfig } from '../runtime/kernel-config.js'
import { loadStorageConfig, type StorageConfig } from '../storage/config.js'
import { loadConsoleConfig, type ConsoleServerConfig } from '../web/config.js'
import type { ProductCompositionManifest } from './manifest.js'

export interface NativeProductConfig extends AssistantKernelConfig, ConsoleServerConfig {
  readonly storage: StorageConfig
  readonly runtime: { readonly mode: 'native' }
}

/** Fail-closed configuration for the post-compatibility product entrypoint. */
export function loadNativeProductConfig(
  manifest: ProductCompositionManifest,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): NativeProductConfig {
  if (env.ASSISTANT_RUNTIME !== 'native') throw new Error('native product entry requires ASSISTANT_RUNTIME=native')
  const kernel = loadAssistantKernelConfig(env, cwd, { kernelProfile: 'feishu-assistant-native' })
  if (kernel.kernel.mode !== 'dsh') throw new Error('native product entry requires ASSISTANT_KERNEL=dsh')
  const missingActivation = manifest.requiredEnvironment.filter(name => env[name] !== 'true')
  if (missingActivation.length) throw new Error(`native product activation is incomplete: ${missingActivation.join(',')}`)
  const missingConfiguration = manifest.requiredConfiguration.filter(name => !env[name]?.trim())
  if (missingConfiguration.length) throw new Error(`native product configuration is incomplete: ${missingConfiguration.join(',')}`)
  const execution = loadExecutionConfig(env, cwd)
  return {
    ...kernel,
    ...loadConsoleConfig(env, execution, true),
    storage: loadStorageConfig(env, cwd),
    runtime: { mode: 'native' },
  }
}
