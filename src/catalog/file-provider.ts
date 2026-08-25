import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateModuleCatalog, type AssistantModuleCatalog, type ModuleCatalogProvider } from '../platform/modules.js'

const defaultCatalogPath = fileURLToPath(new URL('../../config/module-catalog.json', import.meta.url))

/** Product composition provider for the concrete QuarkSelfAI module catalog. */
export async function loadModuleCatalog(path = defaultCatalogPath): Promise<AssistantModuleCatalog> {
  return validateModuleCatalog(JSON.parse(await readFile(path, 'utf8')))
}

export class FileModuleCatalogProvider implements ModuleCatalogProvider {
  constructor(private readonly path = defaultCatalogPath) {}

  async load(): Promise<AssistantModuleCatalog> { return await loadModuleCatalog(this.path) }
}
