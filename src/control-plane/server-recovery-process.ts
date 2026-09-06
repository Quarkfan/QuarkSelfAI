import { execFile as execFileCallback } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/** Narrow host-process adapter for the fixed argv produced by server recovery policy. */
export async function runServerRecoveryProcess(binary: string, args: readonly string[]): Promise<{ stdout: string }> {
  try { return await execFile(binary, [...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) }
  catch { throw new Error(`${basename(binary)} failed`) }
}
