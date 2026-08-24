import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssistantApplication } from '../src/bootstrap/application.js'

test('starts the application skeleton without requiring a surface feature', async () => {
  let healthChecks = 0
  let closes = 0
  const application = await createAssistantApplication(
    { kernel: { mode: 'off' } },
    {
      store: {
        kind: 'fixture',
        health: async () => { healthChecks += 1 },
        close: async () => { closes += 1 },
      },
    },
  )
  await application.start()
  assert.equal(healthChecks, 1)
  assert.deepEqual(application.snapshot().map(component => component.id), ['assistant-store'])
  await application.stop()
  assert.equal(closes, 1)
})

test('lets a surface factory observe the kernel without becoming a skeleton dependency', async () => {
  let observedMode = ''
  const application = await createAssistantApplication(
    { kernel: { mode: 'off' } },
    { store: { kind: 'fixture', health: async () => {}, close: async () => {} } },
    {
      componentFactories: [({ kernelStatus }) => ({
        id: 'fixture-surface',
        kind: 'surface',
        start: () => { observedMode = kernelStatus.snapshot().mode },
        stop: () => {},
      })],
    },
  )
  await application.start()
  assert.equal(observedMode, 'off')
  await application.stop()
})
