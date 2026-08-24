import { isAbsolute, resolve } from 'node:path'

export type ExecutionConfig =
  | { readonly mode: 'local'; readonly workspaceRoots: readonly string[] }
  | { readonly mode: 'remote'; readonly workspaceRoots: readonly [] }

export function loadExecutionConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ExecutionConfig {
  const mode = env.ASSISTANT_EXECUTION_MODE ?? 'local'
  if (mode !== 'local' && mode !== 'remote') {
    throw new Error(`ASSISTANT_EXECUTION_MODE must be local or remote, received ${mode}`)
  }
  return mode === 'local'
    ? { mode, workspaceRoots: workspaceRoots(env.ASSISTANT_WORKSPACE_ROOTS, cwd) }
    : { mode, workspaceRoots: [] }
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
