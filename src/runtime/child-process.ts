import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'

/**
 * Sends a graceful termination signal and waits for the child without leaving
 * the timeout handle alive after an early exit.
 */
export async function terminateChildGracefully(
  child: ChildProcess,
  timeoutMs: number,
  signal: NodeJS.Signals = 'SIGTERM',
): Promise<boolean> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('child termination timeoutMs must be a positive safe integer')
  }
  if (child.exitCode !== null || child.signalCode !== null) return true

  child.kill(signal)
  let timer: NodeJS.Timeout | undefined
  try {
    const exited = once(child, 'exit').then(() => true)
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    return await Promise.race([exited, timedOut])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
