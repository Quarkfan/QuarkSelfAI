import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { loadFeatureParity } from '../src/config/feature-parity.js'

const parity = await loadFeatureParity()
const incomplete = parity.features
  .filter((feature) => feature.requiredForTakeover && feature.status !== 'complete')
  .map(({ id, name, status }) => ({ id, name, status }))
const configPath = process.env.COMPAT_CONFIG_PATH?.trim()
let configReadable = false
if (configPath) {
  try {
    await access(configPath, constants.R_OK)
    configReadable = true
  } catch {
    configReadable = false
  }
}
const ready = parity.takeoverReady && configReadable && process.env.TAKEOVER_CONFIRMED === 'true'
process.stdout.write(`${JSON.stringify({
  ready,
  architectureMode: 'compatibility-provider',
  featureParityReady: parity.takeoverReady,
  compatibilityConfigReadable: configReadable,
  explicitTakeoverConfirmation: process.env.TAKEOVER_CONFIRMED === 'true',
  incomplete,
}, null, 2)}\n`)
if (!ready) process.exitCode = 1
