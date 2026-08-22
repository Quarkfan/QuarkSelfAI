import { execFile } from 'node:child_process'
import { parseJsonDocument, isRecord } from './json.js'

export interface CliOutput {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface CommandRunner {
  run(executable: string, args: readonly string[], signal?: AbortSignal): Promise<CliOutput>
}

export class ProcessCommandRunner implements CommandRunner {
  async run(executable: string, args: readonly string[], signal?: AbortSignal): Promise<CliOutput> {
    return await new Promise((resolve, reject) => {
      const child = execFile(executable, [...args], { signal, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error)
          return
        }
        resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 })
      })
      child.once('error', reject)
    })
  }
}

export async function runJson(
  runner: CommandRunner,
  executable: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<unknown> {
  const output = await runner.run(executable, args, signal)
  if (output.exitCode !== 0) {
    throw new Error(`lark-cli exited ${output.exitCode}: ${output.stderr.trim() || output.stdout.trim()}`)
  }
  const value = parseJsonDocument(output.stdout)
  if (isRecord(value) && 'ok' in value && value.ok !== true) {
    const detail = typeof value.error === 'string' ? value.error : JSON.stringify(value)
    throw new Error(`lark-cli returned ok=false: ${detail}`)
  }
  return value
}
