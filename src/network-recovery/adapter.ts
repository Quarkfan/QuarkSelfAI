import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { endpointHealthy, nextRecoveryStep } from './policy.js'
import type {
  ConnectivityProbe, NetworkRecoveryAttempt, NetworkRecoveryConfig, NetworkRecoveryReport, NetworkRecoveryStep,
} from './types.js'

const execFileAsync = promisify(execFile)

export interface NetworkCommandRunner {
  run(executable: string, args: readonly string[], timeoutMs: number): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }>
}
export class ProcessNetworkCommandRunner implements NetworkCommandRunner {
  async run(executable: string, args: readonly string[], timeoutMs: number) {
    try {
      const result = await execFileAsync(executable, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024 })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
    } catch (error) {
      const value = error as Error & { stdout?: string; stderr?: string; code?: number | string }
      return { stdout: value.stdout ?? '', stderr: value.stderr ?? value.message, exitCode: typeof value.code === 'number' ? value.code : 1 }
    }
  }
}

export class NetworkRecoveryAdapter {
  constructor(
    private readonly config: NetworkRecoveryConfig,
    private readonly runner: NetworkCommandRunner = new ProcessNetworkCommandRunner(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recover(): Promise<NetworkRecoveryReport> {
    const startedAt = this.now().toISOString()
    if (this.config.enabled !== true) return this.report('skipped', startedAt, [], false, 'network recovery is disabled')
    const attempts: NetworkRecoveryAttempt[] = []
    const completed: NetworkRecoveryStep[] = []
    let probe = await this.probe()
    attempts.push({ step: 'probe', probe })
    if (endpointHealthy(probe)) return this.report('healthy', startedAt, attempts, false, 'Codex and Feishu endpoints are reachable')
    if (this.config.mutationsEnabled !== true) {
      return this.report('failed', startedAt, attempts, true, 'connectivity is unhealthy and network mutations are not authorized')
    }
    while (true) {
      const step = nextRecoveryStep(probe, completed)
      if (!step) return this.report('failed', startedAt, attempts, true, 'all authorized recovery stages were exhausted')
      const mutation = await this.mutate(step)
      attempts.push({ step, changed: mutation.changed, detail: mutation.detail })
      completed.push(step)
      if (!mutation.changed) continue
      probe = await this.probe()
      attempts.push({ step: 'probe', probe })
      if (endpointHealthy(probe)) return this.report('recovered', startedAt, attempts, false, `connectivity recovered after ${step}`)
    }
  }

  async probe(): Promise<ConnectivityProbe> {
    const [currentGoogle, directGoogle, codex, feishu, blacklake] = await Promise.all([
      this.curl(this.config.googleUrl ?? 'https://www.google.com/generate_204', false),
      this.curl(this.config.googleUrl ?? 'https://www.google.com/generate_204', true),
      this.curl(this.config.codexUrl ?? 'https://chatgpt.com/', false),
      this.curl(this.config.feishuUrl ?? 'https://open.feishu.cn/', false),
      this.config.blacklakeUrl ? this.curl(this.config.blacklakeUrl, false) : Promise.resolve(false),
    ])
    return { currentGoogle, directGoogle, codex, feishu, blacklake, observedAt: this.now().toISOString() }
  }

  private async curl(url: string, direct: boolean): Promise<boolean> {
    const args = ['--silent', '--show-error', '--output', '/dev/null', '--connect-timeout', '3', '--max-time', '8', '--write-out', '%{http_code}']
    if (direct) args.push('--noproxy', '*')
    args.push(url)
    const result = await this.runner.run('/usr/bin/curl', args, 10_000)
    return result.exitCode === 0 && /^[234]\d\d$/.test(result.stdout.trim())
  }

  private async mutate(step: Exclude<NetworkRecoveryStep, 'probe'>): Promise<{ changed: boolean; detail: string }> {
    const executable = this.config.helperExecutable
    if (!executable?.startsWith('/')) return { changed: false, detail: 'an absolute, reviewed helperExecutable is required' }
    const result = await this.runner.run(executable, [step], 45_000)
    return {
      changed: result.exitCode === 0,
      detail: (result.exitCode === 0 ? result.stdout : result.stderr).trim().slice(0, 1_000) || `helper exited ${result.exitCode}`,
    }
  }

  private report(outcome: NetworkRecoveryReport['outcome'], startedAt: string, attempts: readonly NetworkRecoveryAttempt[], notificationRequired: boolean, reason: string): NetworkRecoveryReport {
    return { outcome, startedAt, completedAt: this.now().toISOString(), attempts, notificationRequired, reason }
  }
}
