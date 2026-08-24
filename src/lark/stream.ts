import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { normalizeLarkEvent } from './normalize.js'
import type { LarkIdentity } from './types.js'

export interface EventStreamOptions {
  readonly executable?: string
  readonly identity: LarkIdentity
  readonly eventKey: string
  readonly readyTimeoutMs?: number
}

export class LarkEventStream {
  private child: ChildProcessWithoutNullStreams | undefined

  async start(
    options: EventStreamOptions,
    onEvent: (event: NormalizedChannelEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.child) throw new Error(`event stream ${options.eventKey} is already running`)
    const executable = options.executable ?? 'lark-cli'
    const child = spawn(executable, ['event', 'consume', options.eventKey, '--as', options.identity], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    const stdout = createInterface({ input: child.stdout })
    stdout.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      void Promise.resolve()
        .then(() => onEvent(normalizeLarkEvent(options.eventKey, JSON.parse(trimmed) as unknown)))
        .catch((error: unknown) => child.emit('error', error instanceof Error ? error : new Error(String(error))))
    })
    const readyTimeoutMs = options.readyTimeoutMs ?? 20_000
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`lark-cli stream ${options.eventKey} did not become ready`)), readyTimeoutMs)
      const stderr = createInterface({ input: child.stderr })
      const cleanup = () => {
        clearTimeout(timer)
        stderr.removeAllListeners()
      }
      stderr.on('line', (line) => {
        if (line.includes(`[event] ready event_key=${options.eventKey}`)) {
          cleanup()
          resolve()
        }
      })
      child.once('exit', (code) => {
        cleanup()
        reject(new Error(`lark-cli stream ${options.eventKey} exited before ready (${String(code)})`))
      })
      child.once('error', (error) => {
        cleanup()
        reject(error)
      })
      signal?.addEventListener('abort', () => {
        cleanup()
        reject(signal.reason instanceof Error ? signal.reason : new Error('event stream aborted'))
      }, { once: true })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null) return
    child.stdin.end()
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
