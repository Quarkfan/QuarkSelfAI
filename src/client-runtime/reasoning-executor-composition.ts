import { lstat, mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { validateExecutorAdapterInput } from '../capability-platform/validation.js'
import type { NoEffectClientExecutorPortV1 } from './contracts.js'
import { ContentAddressedLocalExecutionResultStoreV1, FixedNoEffectReasoningExecutorV1, type FixedReasoningProcessRunnerV1, type ReasoningExecutorIdV1 } from './reasoning-executor-adapter.js'

const executorOrder = Object.freeze(['claude-code', 'codex', 'dsh'] as const)

export interface ProductReasoningExecutorDependenciesV1 {
  readonly runner?: FixedReasoningProcessRunnerV1
  readonly clock?: () => Date
}

/** Builds the three product adapters without selecting or invoking any of them. */
export async function createProductReasoningExecutors(runtimeRoot: string, resultRoot: string, dependencies: ProductReasoningExecutorDependenciesV1 = {}): Promise<readonly NoEffectClientExecutorPortV1[]> {
  for (const path of [runtimeRoot, resultRoot]) if (!isAbsolute(path) || resolve(path) !== path) throw new Error('reasoning executor roots must be exact absolute paths')
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  const [canonicalRuntime, runtimeStatus] = await Promise.all([realpath(runtimeRoot), lstat(runtimeRoot)])
  if (canonicalRuntime !== runtimeRoot || !runtimeStatus.isDirectory() || runtimeStatus.isSymbolicLink() || (runtimeStatus.mode & 0o077) !== 0) throw new Error('reasoning executor runtime root must be a private canonical directory')
  const results = await ContentAddressedLocalExecutionResultStoreV1.open(resultRoot)
  return Object.freeze(executorOrder.map((executorId: ReasoningExecutorIdV1) => new FixedNoEffectReasoningExecutorV1(executorId, canonicalRuntime, results, { validate: validateExecutorAdapterInput }, dependencies.runner, dependencies.clock)))
}
