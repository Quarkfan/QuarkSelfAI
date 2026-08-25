import { loadRuntimeConfig } from './config/runtime.js'
import { createConfiguredAssistantApplication } from './runtime/compat-composition.js'
import { runAssistantApplication } from './bootstrap/run.js'

const config = loadRuntimeConfig()
const application = await createConfiguredAssistantApplication(config)
await runAssistantApplication(application)
