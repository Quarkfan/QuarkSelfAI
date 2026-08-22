import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const compatRoot = fileURLToPath(new URL('../../packages/bridge-compat/', import.meta.url))
const compatEntry = fileURLToPath(new URL('../../packages/bridge-compat/src/index.js', import.meta.url))

export interface RuntimeSnapshot {
  readonly mode: 'control-only' | 'compat'
  readonly state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed'
  readonly pid?: number
  readonly messageReady: boolean
  readonly cardReady: boolean
  readonly startedAt?: string
  readonly lastError?: string
}

export interface RuntimeStatusProvider {
  snapshot(): RuntimeSnapshot
}

export class CompatReadinessObserver {
  private tail = ''

  observe(snapshot: RuntimeSnapshot, text: string, pid?: number): RuntimeSnapshot {
    this.tail = `${this.tail}${text}`.slice(-4_096)
    const messageReady = snapshot.messageReady || this.tail.includes('[event] ready event_key=im.message.receive_v1')
    const cardReady = snapshot.cardReady || this.tail.includes('[event] ready event_key=card.action.trigger')
    return {
      ...snapshot,
      state: messageReady && cardReady ? 'ready' : snapshot.state,
      messageReady,
      cardReady,
      ...(pid ? { pid } : {}),
    }
  }
}

export class ControlOnlyRuntime implements RuntimeStatusProvider {
  snapshot(): RuntimeSnapshot {
    return { mode: 'control-only', state: 'stopped', messageReady: false, cardReady: false }
  }
}

export class CompatRuntime implements RuntimeStatusProvider {
  private child: ChildProcessWithoutNullStreams | undefined
  private readonly readiness = new CompatReadinessObserver()
  private readonly failurePromise: Promise<Error>
  private resolveFailure!: (error: Error) => void
  private current: RuntimeSnapshot = {
    mode: 'compat',
    state: 'stopped',
    messageReady: false,
    cardReady: false,
  }

  constructor(
    private readonly configPath: string,
    private readonly processOptions: { readonly entry?: string; readonly cwd?: string; readonly executable?: string } = {},
  ) {
    this.failurePromise = new Promise((resolve) => { this.resolveFailure = resolve })
  }

  snapshot(): RuntimeSnapshot {
    return { ...this.current }
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('compat runtime is already started')
    this.current = {
      mode: 'compat',
      state: 'starting',
      messageReady: false,
      cardReady: false,
      startedAt: new Date().toISOString(),
    }
    const child = spawn(this.processOptions.executable ?? process.execPath, [this.processOptions.entry ?? compatEntry], {
      cwd: this.processOptions.cwd ?? compatRoot,
      env: {
        ...process.env,
        CODEX_LARK_CONFIG: this.configPath,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    const observe = (chunk: Buffer, target: NodeJS.WriteStream): void => {
      const text = chunk.toString('utf8')
      target.write(text)
      this.current = this.readiness.observe(this.current, text, child.pid)
    }
    child.stdout.on('data', (chunk: Buffer) => observe(chunk, process.stdout))
    child.stderr.on('data', (chunk: Buffer) => observe(chunk, process.stderr))
    child.once('error', (error) => {
      this.current = { ...this.current, state: 'failed', lastError: error.message }
      this.resolveFailure(error)
    })
    child.once('exit', (code, signal) => {
      const expected = this.child === undefined
      this.child = undefined
      const { lastError: _lastError, ...snapshotWithoutError } = this.current
      this.current = expected
        ? { ...snapshotWithoutError, state: 'stopped' }
        : {
            ...snapshotWithoutError,
            state: 'failed',
            lastError: `compat runtime exited code=${String(code)} signal=${String(signal)}`,
          }
      if (!expected) this.resolveFailure(new Error(this.current.lastError ?? 'compat runtime exited unexpectedly'))
    })
    await once(child, 'spawn')
    this.current = { ...this.current, ...(child.pid ? { pid: child.pid } : {}) }
  }

  async waitUntilReady(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.current.state === 'ready') return
      if (this.current.state === 'failed') throw new Error(this.current.lastError ?? 'compat runtime failed')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    this.current = { ...this.current, state: 'degraded', lastError: 'compat runtime readiness timed out' }
    throw new Error('compat runtime did not make both Feishu consumers ready')
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
      this.current = { ...this.current, state: 'degraded', lastError: 'compat runtime did not stop gracefully; SIGKILL was intentionally not used' }
      throw new Error(this.current.lastError)
    }
    this.current = { mode: 'compat', state: 'stopped', messageReady: false, cardReady: false }
  }
}
