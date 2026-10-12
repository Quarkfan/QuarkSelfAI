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
  readonly onFailure?: (failure: Error) => void
}

type StreamState = 'idle' | 'starting' | 'ready' | 'stopping' | 'failed'
const maxBufferedLines = 128

/** One CLI EventKey process. Failure is terminal until stop() confirms child exit. */
export class LarkEventStream {
  private child: ChildProcessWithoutNullStreams | undefined
  private state: StreamState = 'idle'
  private closed = false
  private closePromise: Promise<void> | undefined
  private dispatchPromise: Promise<void> | undefined
  private abortCleanup: (() => void) | undefined

  constructor(private readonly spawnProcess: typeof spawn = spawn) {}

  status(): StreamState { return this.state }

  async start(
    options: EventStreamOptions,
    onEvent: (event: NormalizedChannelEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.child) throw new Error(`event stream ${options.eventKey} has not been fully stopped`)
    if (signal?.aborted) throw new Error(`event stream ${options.eventKey} was aborted before start`)
    const child = this.spawnProcess(options.executable ?? 'lark-cli', ['event', 'consume', options.eventKey, '--as', options.identity], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.state = 'starting'
    this.closed = false
    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })
    const lines: string[] = []
    let draining = false
    let started = false
    let startupResolve: (() => void) | undefined
    let startupReject: ((error: Error) => void) | undefined
    const ready = new Promise<void>((resolve, reject) => { startupResolve = resolve; startupReject = reject })
    let closeResolve: (() => void) | undefined
    this.closePromise = new Promise<void>(resolve => { closeResolve = resolve })
    let lastErrorCategory = 'unknown'

    const fail = (category: string) => {
      if (this.state === 'failed' || this.state === 'stopping' || this.state === 'idle') return
      this.state = 'failed'
      lines.length = 0
      const failure = new Error(`lark-cli event stream ${options.eventKey} failed: ${category}`)
      if (!started) startupReject?.(failure)
      try { options.onFailure?.(failure) } catch { /* observer cannot restore the stream */ }
      if (!this.closed) { child.stdin.end(); child.kill('SIGTERM') }
    }

    const drain = async () => {
      if (draining || this.state !== 'ready') return
      draining = true
      child.stdout.pause()
      try {
        while (lines.length > 0 && this.state === 'ready') {
          const line = lines.shift()!
          try { await onEvent(normalizeLarkEvent(options.eventKey, JSON.parse(line) as unknown)) }
          catch { fail('event-handler-or-payload'); break }
        }
      } finally {
        draining = false
        if (this.state === 'ready') child.stdout.resume()
      }
    }

    stdout.on('line', line => {
      if (this.state !== 'starting' && this.state !== 'ready') return
      if (!line.trim()) return
      if (lines.length >= maxBufferedLines) { fail('local-buffer-limit'); return }
      lines.push(line)
      if (!draining) this.dispatchPromise = drain()
    })
    stderr.on('line', line => {
      if (line.trim() === `[event] ready event_key=${options.eventKey}` && this.state === 'starting') {
        started = true
        this.state = 'ready'
        startupResolve?.()
        if (lines.length > 0 && !draining) this.dispatchPromise = drain()
        return
      }
      if (line.trim().startsWith('{')) {
        try {
          const value = JSON.parse(line) as { error?: { type?: unknown; subtype?: unknown } }
          const type = typeof value.error?.type === 'string' ? value.error.type : 'cli-error'
          const subtype = typeof value.error?.subtype === 'string' ? value.error.subtype : 'unknown'
          lastErrorCategory = `${safeCategory(type)}.${safeCategory(subtype)}`
        } catch { lastErrorCategory = 'cli-error' }
      }
      if (/\bWARN\b/u.test(line) && /\b(drop|skip)/iu.test(line)) fail('cli-event-drop-warning')
    })
    child.once('error', () => fail('child-process-error'))
    child.once('close', (code, childSignal) => {
      this.closed = true
      closeResolve?.()
      stdout.close()
      stderr.close()
      this.abortCleanup?.()
      this.abortCleanup = undefined
      if (this.state !== 'stopping' && this.state !== 'failed') fail(`unexpected-close.${code ?? childSignal ?? 'unknown'}.${lastErrorCategory}`)
    })
    if (signal) {
      const onAbort = () => fail('aborted')
      signal.addEventListener('abort', onAbort, { once: true })
      this.abortCleanup = () => signal.removeEventListener('abort', onAbort)
    }
    const timeout = setTimeout(() => fail('ready-timeout'), options.readyTimeoutMs ?? 20_000)
    try { await ready }
    finally { clearTimeout(timeout) }
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    const child = this.child
    if (!child) return
    this.state = 'stopping'
    child.stdin.end()
    if (!this.closed) child.kill('SIGTERM')
    let timer: ReturnType<typeof setTimeout> | undefined
    const closed = await Promise.race([
      Promise.all([this.closePromise!, this.dispatchPromise ?? Promise.resolve()]).then(() => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
    ])
    if (timer) clearTimeout(timer)
    if (!closed) {
      this.state = 'failed'
      throw new Error('lark-cli event stream stop timed out; consumer ownership is uncertain')
    }
    this.child = undefined
    this.closePromise = undefined
    this.dispatchPromise = undefined
    this.state = 'idle'
  }
}

function safeCategory(value: string): string { return /^[a-zA-Z_][a-zA-Z_0-9-]{0,63}$/u.test(value) ? value : 'unknown' }
