import { resolve } from 'node:path'
import type { StorageConfig, StorageKind } from './types.js'

function storageKind(value: string | undefined): StorageKind {
  if (!value || value === 'sqlite') return 'sqlite'
  if (value === 'postgres' || value === 'pg') return 'postgres'
  throw new Error(`ASSISTANT_STORAGE must be sqlite or postgres, received ${value}`)
}

/** Configuration owned by the replaceable durable-state provider. */
export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): StorageConfig {
  const kind = storageKind(env.ASSISTANT_STORAGE)
  if (kind === 'postgres') {
    const databaseUrl = env.DATABASE_URL?.trim() || ''
    if (!databaseUrl) throw new Error('DATABASE_URL is required when ASSISTANT_STORAGE=postgres')
    return { kind, databaseUrl }
  }
  return { kind, path: resolve(cwd, env.SQLITE_PATH ?? 'var/quarkselfai.sqlite3') }
}
