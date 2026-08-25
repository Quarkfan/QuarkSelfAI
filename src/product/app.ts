import { runAssistantApplication } from '../bootstrap/run.js'
import { loadModuleCatalog } from '../catalog/file-provider.js'
import { createNativeProductApplication } from './composition.js'
import { loadNativeProductConfig } from './config.js'
import { loadProductCompositionManifest } from './manifest.js'

const catalog = await loadModuleCatalog()
const manifest = await loadProductCompositionManifest(catalog)
const config = loadNativeProductConfig(manifest)
const application = await createNativeProductApplication(config, manifest)
await runAssistantApplication(application)
