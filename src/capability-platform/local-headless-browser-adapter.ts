import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { validateHeadlessBrowserLaunchV1, type HeadlessBrowserHostPortV1, type HeadlessBrowserLaunchV1, type HeadlessBrowserSessionV1 } from './headless-browser-runtime.js'

export interface LocalHeadlessBrowserProgramV1 {
  readonly executable: string
  readonly leadingArguments?: readonly string[]
}

export interface LocalHeadlessBrowserAdapterOptionsV1 {
  readonly profileParent: string
  readonly startupProbeMs?: number
  readonly stopTimeoutMs?: number
}

interface ActiveSession {
  readonly id: string
  readonly profilePath: string
  readonly child: ChildProcess
}

/**
 * Host-owned inactive adapter for an already-installed browser program.
 * Cloud input cannot select the executable, arguments, environment or profile path.
 */
export class LocalHeadlessBrowserAdapterV1 implements HeadlessBrowserHostPortV1 {
  readonly #program: LocalHeadlessBrowserProgramV1
  readonly #profileParent: string
  readonly #startupProbeMs: number
  readonly #stopTimeoutMs: number
  readonly #sessions = new Map<string, ActiveSession>()

  constructor(program: LocalHeadlessBrowserProgramV1, options: LocalHeadlessBrowserAdapterOptionsV1) {
    if (!program.executable || !resolve(program.executable).startsWith('/')) throw new Error('headless browser executable must be an absolute host-owned path')
    if ((program.leadingArguments ?? []).some(argument => typeof argument !== 'string' || argument.includes('\0'))) throw new Error('headless browser leading arguments are invalid')
    if (!options.profileParent || !resolve(options.profileParent).startsWith('/')) throw new Error('headless browser profile parent must be an absolute host-owned path')
    this.#program = Object.freeze({ executable: resolve(program.executable), leadingArguments: Object.freeze([...(program.leadingArguments ?? [])]) })
    this.#profileParent = resolve(options.profileParent)
    this.#startupProbeMs = boundedDuration(options.startupProbeMs ?? 50, 'startup probe')
    this.#stopTimeoutMs = boundedDuration(options.stopTimeoutMs ?? 5_000, 'stop timeout')
  }

  async start(input: HeadlessBrowserLaunchV1): Promise<HeadlessBrowserSessionV1> {
    const request = validateHeadlessBrowserLaunchV1(input)
    if (request.network !== 'denied' || request.workspaceAccess !== 'denied') throw new Error('inactive local browser adapter accepts only denied network and workspace access')
    await mkdir(this.#profileParent, { recursive: true, mode: 0o700 })
    await chmod(this.#profileParent, 0o700)
    const profilePath = await mkdtemp(join(this.#profileParent, 'session-'))
    await chmod(profilePath, 0o700)
    const id = `browser:${randomUUID()}`
    const arguments_ = [
      ...(this.#program.leadingArguments ?? []),
      '--headless=new',
      `--user-data-dir=${profilePath}`,
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND',
      'about:blank',
    ]
    const child = spawn(this.#program.executable, arguments_, {
      cwd: profilePath,
      env: { HOME: profilePath, TMPDIR: profilePath, NO_PROXY: '*' },
      stdio: 'ignore',
      shell: false,
    })
    try {
      await spawnedAndStable(child, this.#startupProbeMs)
      this.#sessions.set(id, { id, profilePath, child })
      return Object.freeze({ sessionId: id, state: 'started', profile: 'ephemeral', externalWritesEnabled: false })
    } catch (error) {
      if (child.exitCode === null) child.kill('SIGTERM')
      await rm(profilePath, { recursive: true, force: true })
      throw error
    }
  }

  async stop(sessionId: string): Promise<HeadlessBrowserSessionV1> {
    const session = this.#sessions.get(sessionId)
    if (!session) throw new Error('headless browser session is not active')
    this.#sessions.delete(sessionId)
    try {
      if (session.child.exitCode === null) {
        session.child.kill('SIGTERM')
        await waitForExit(session.child, this.#stopTimeoutMs)
      }
    } finally {
      await rm(session.profilePath, { recursive: true, force: true })
    }
    return Object.freeze({ sessionId, state: 'stopped', profile: 'ephemeral', externalWritesEnabled: false })
  }

  activeSessionCount(): number { return this.#sessions.size }
}

function boundedDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) throw new Error(`${label} duration is invalid`)
  return value
}

async function spawnedAndStable(child: ChildProcess, probeMs: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(resolvePromise), probeMs)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
      callback()
    }
    const onError = (error: Error) => finish(() => reject(error))
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(() => reject(new Error(`headless browser exited during startup (${code ?? signal ?? 'unknown'})`)))
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('headless browser did not stop before timeout'))
    }, timeoutMs)
    child.once('exit', () => { clearTimeout(timer); resolvePromise() })
    child.once('error', error => { clearTimeout(timer); reject(error) })
  })
}
