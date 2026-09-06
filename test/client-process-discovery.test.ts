import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyFixedExecutorProbe, fixedExecutorProbeSpecs } from '../src/client-runtime/process-discovery.js'

const now = new Date('2026-09-06T00:00:00.000Z')

test('classifies fixed executor fixtures without exposing process output or paths', () => {
  const reports = fixedExecutorProbeSpecs().map((spec, index) => classifyFixedExecutorProbe(spec, {
    state: 'completed',
    exitCode: 0,
    output: `${spec.executorId} ${index + 1}.2.3 private-account@example.invalid`,
    authentication: 'ready',
  }, 'device.owner', now))
  assert.deepEqual(reports.map(report => [report.executorId, report.availability, report.version]), [
    ['claude-code', 'ready', '1.2.3'],
    ['codex', 'ready', '2.2.3'],
    ['dsh', 'ready', '3.2.3'],
  ])
  assert.doesNotMatch(JSON.stringify(reports), /private-account|example\.invalid|\/Users\//)
  assert.ok(Object.isFrozen(fixedExecutorProbeSpecs()))
})

test('fails closed for missing auth, timeout, missing binaries and malformed output', () => {
  const spec = fixedExecutorProbeSpecs()[0]!
  assert.equal(classifyFixedExecutorProbe(spec, { state: 'completed', exitCode: 0, output: '1.2.3', authentication: 'required' }, 'device.owner', now).availability, 'auth-required')
  assert.equal(classifyFixedExecutorProbe(spec, { state: 'timed-out', exitCode: null, output: '', authentication: 'unknown' }, 'device.owner', now).availability, 'unavailable')
  assert.equal(classifyFixedExecutorProbe(spec, { state: 'not-found', exitCode: null, output: '', authentication: 'unknown' }, 'device.owner', now).availability, 'not-installed')
  assert.equal(classifyFixedExecutorProbe(spec, { state: 'completed', exitCode: 0, output: 'unknown', authentication: 'ready' }, 'device.owner', now).availability, 'unavailable')
  assert.equal(classifyFixedExecutorProbe(spec, { state: 'completed', exitCode: 0, output: '0.0.9', authentication: 'ready' }, 'device.owner', now).availability, 'version-unsupported')
  assert.throws(() => classifyFixedExecutorProbe({ ...spec, args: ['run'] }, { state: 'completed', exitCode: 0, output: '1.2.3', authentication: 'ready' }, 'device.owner', now), /fixed allowlist/)
  assert.throws(() => classifyFixedExecutorProbe(spec, { state: 'timed-out', exitCode: 1, output: '', authentication: 'unknown' }, 'device.owner', now), /disagree/)
  assert.throws(() => classifyFixedExecutorProbe(spec, { state: 'completed', exitCode: 0, output: 'x'.repeat(4_097), authentication: 'ready' }, 'device.owner', now), /not bounded/)
})
