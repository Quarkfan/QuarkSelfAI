import assert from 'node:assert/strict'
import test from 'node:test'
import { NetworkRecoveryAdapter, type NetworkCommandRunner } from '../src/network-recovery/adapter.js'
import { isNetworkRecoveryCandidate, nextRecoveryStep, recoveryBucket } from '../src/network-recovery/policy.js'
import type { ConnectivityProbe } from '../src/network-recovery/types.js'

const unhealthy: ConnectivityProbe = {
  currentGoogle: false, directGoogle: false, codex: false, feishu: false, blacklake: false,
  observedAt: '2026-08-28T03:00:00.000Z',
}

test('only repeated connection failures enter network recovery', () => {
  assert.equal(isNetworkRecoveryCandidate({ actionId: 'a', attempt: 2, error: 'DNS connection timeout', occurredAt: unhealthy.observedAt }), true)
  assert.equal(isNetworkRecoveryCandidate({ actionId: 'a', attempt: 1, error: 'DNS connection timeout', occurredAt: unhealthy.observedAt }), false)
  assert.equal(isNetworkRecoveryCandidate({ actionId: 'a', attempt: 3, error: '401 unauthorized connection', occurredAt: unhealthy.observedAt }), false)
  assert.equal(isNetworkRecoveryCandidate({ actionId: 'a', attempt: 3, error: 'Invalid schema for response_format', occurredAt: unhealthy.observedAt }), false)
})

test('policy diagnoses proxy first and then advances through allowlisted stages', () => {
  assert.equal(nextRecoveryStep({ ...unhealthy, directGoogle: true }, []), 'disable-clash')
  assert.equal(nextRecoveryStep(unhealthy, []), 'disable-clash')
  assert.equal(nextRecoveryStep(unhealthy, ['disable-clash']), 'switch-calvin')
  assert.equal(nextRecoveryStep(unhealthy, ['disable-clash', 'switch-calvin']), 'switch-blacklake')
  assert.equal(nextRecoveryStep(unhealthy, ['disable-clash', 'switch-calvin', 'switch-blacklake']), 'enable-blacklake-route')
  assert.equal(nextRecoveryStep({ ...unhealthy, codex: true, feishu: true }, []), null)
  assert.equal(recoveryBucket('2026-08-28T03:29:59.000Z'), recoveryBucket('2026-08-28T03:00:00.000Z'))
})

test('disabled adapter never executes probes or mutations', async () => {
  const runner: NetworkCommandRunner = { async run() { throw new Error('must not run') } }
  const report = await new NetworkRecoveryAdapter({}, runner).recover()
  assert.equal(report.outcome, 'skipped')
})

test('read-only mode probes and fails closed without invoking a helper', async () => {
  const calls: string[][] = []
  const runner: NetworkCommandRunner = {
    async run(executable, args) {
      calls.push([executable, ...args])
      return { stdout: '000', stderr: 'offline', exitCode: 7 }
    },
  }
  const report = await new NetworkRecoveryAdapter({ enabled: true, mutationsEnabled: false }, runner).recover()
  assert.equal(report.outcome, 'failed')
  assert.equal(report.notificationRequired, true)
  assert.equal(calls.length, 4)
  assert.equal(calls.every(call => call[0] === '/usr/bin/curl'), true)
})

test('mutation mode uses only fixed helper subcommands and stops after recovery', async () => {
  let probeRound = 0
  const helperSteps: string[] = []
  const runner: NetworkCommandRunner = {
    async run(executable, args) {
      if (executable === '/reviewed/helper') {
        helperSteps.push(args[0]!)
        probeRound += 1
        return { stdout: 'ok', stderr: '', exitCode: 0 }
      }
      const url = args.at(-1)!
      const healthy = probeRound >= 1 && (url.includes('chatgpt.com') || url.includes('feishu.cn'))
      return { stdout: healthy ? '204' : '000', stderr: '', exitCode: healthy ? 0 : 7 }
    },
  }
  const report = await new NetworkRecoveryAdapter({ enabled: true, mutationsEnabled: true, helperExecutable: '/reviewed/helper' }, runner).recover()
  assert.equal(report.outcome, 'recovered')
  assert.deepEqual(helperSteps, ['disable-clash'])
})
