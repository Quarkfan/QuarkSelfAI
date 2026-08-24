import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import type { KernelSnapshot, KernelStatusProvider } from '../platform/operations.js'

export type { KernelSnapshot, KernelStatusProvider } from '../platform/operations.js'

export class DisabledKernelRuntime implements KernelStatusProvider {
  snapshot(): KernelSnapshot {
    return { mode: 'off', state: 'stopped' }
  }
}

export class DshKernelRuntime implements KernelStatusProvider {
  private child: ChildProcessWithoutNullStreams | undefined
  private readonly failurePromise: Promise<Error>
  private resolveFailure!: (error: Error) => void
  private current: KernelSnapshot

  constructor(private readonly config: {
    readonly command: string
    readonly args: readonly string[]
    readonly cwd: string
    readonly home: string
    readonly profile: string
    readonly stabilizationMs?: number
  }) {
    this.current = { mode: 'dsh', state: 'stopped', profile: config.profile }
    this.failurePromise = new Promise((resolve) => { this.resolveFailure = resolve })
  }

  snapshot(): KernelSnapshot {
    return { ...this.current }
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('DSH kernel is already started')
    this.current = {
      mode: 'dsh', state: 'starting', profile: this.config.profile, startedAt: new Date().toISOString(),
    }
    const child = spawn(this.config.command, [...this.config.args], {
      cwd: this.config.cwd,
      env: { ...process.env, DSH_HOME: this.config.home },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    child.once('error', (error) => this.fail(error))
    child.once('exit', (code, signal) => {
      const expected = this.child === undefined
      this.child = undefined
      if (expected) {
        this.current = { mode: 'dsh', state: 'stopped', profile: this.config.profile }
        return
      }
      this.fail(new Error(`DSH kernel exited code=${String(code)} signal=${String(signal)}`))
    })
    await once(child, 'spawn')
    const delay = this.config.stabilizationMs ?? 1_000
    await Promise.race([
      new Promise<void>((resolve) => setTimeout(resolve, delay)),
      this.failurePromise.then((error) => Promise.reject(error)),
    ])
    if (!this.child || child.exitCode !== null) throw new Error(this.current.lastError ?? 'DSH kernel exited during startup')
    this.current = { ...this.current, state: 'ready', ...(child.pid ? { pid: child.pid } : {}) }
  }

  async waitForFailure(): Promise<Error> {
    return await this.failurePromise
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) return
    this.child = undefined
    child.kill('SIGTERM')
    const exited = once(child, 'exit').then(() => true)
    const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000))
    if (!await Promise.race([exited, timedOut])) {
      this.child = child
      this.current = { ...this.current, state: 'degraded', lastError: 'DSH kernel did not stop gracefully; SIGKILL was intentionally not used' }
      throw new Error(this.current.lastError)
    }
    this.current = { mode: 'dsh', state: 'stopped', profile: this.config.profile }
  }

  private fail(error: Error): void {
    this.current = { ...this.current, state: 'failed', lastError: error.message }
    this.resolveFailure(error)
  }
}
