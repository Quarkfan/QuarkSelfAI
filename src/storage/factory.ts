import { fileURLToPath } from 'node:url'
import { createPgPool, PgAssistantStore } from './postgres.js'
import { createSqliteStore } from './sqlite.js'
import type { StorageConfig } from './config.js'
import type { AssistantStore } from './types.js'

const sqliteMigrations = fileURLToPath(new URL('../../migrations/sqlite/', import.meta.url))
const postgresMigrations = fileURLToPath(new URL('../../migrations/', import.meta.url))

export async function createAssistantStore(config: { readonly storage: StorageConfig }): Promise<AssistantStore> {
  if (config.storage.kind === 'postgres') {
    const store = new PgAssistantStore(createPgPool({ connectionString: config.storage.databaseUrl }), postgresMigrations)
    await store.migrate()
    return store
  }
  const store = await createSqliteStore(config.storage.path, sqliteMigrations)
  await store.migrate()
  return store
}
