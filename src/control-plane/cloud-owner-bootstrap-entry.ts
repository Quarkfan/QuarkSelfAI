import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bootstrapFirstCloudOwnerV1, type FirstCloudOwnerBootstrapV1 } from './cloud-owner-bootstrap.js'

async function main(): Promise<void> {
  if (process.env.QUARK_CLOUD_BOOTSTRAP_ENABLE !== '1' || process.argv.length !== 4 || process.argv[2] !== 'bootstrap-owner') throw new Error('cloud owner bootstrap is disabled')
  const configPath = process.argv[3]!
  if (!isAbsolute(configPath) || resolve(configPath) !== configPath) throw new Error('cloud owner bootstrap config is invalid')
  const stat = await lstat(configPath); const uid = process.getuid?.()
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 || (stat.mode & 0o077) !== 0 || await realpath(configPath) !== configPath || (uid !== undefined && stat.uid !== uid)) throw new Error('cloud owner bootstrap config is invalid')
  const input = JSON.parse(await readFile(configPath, 'utf8')) as FirstCloudOwnerBootstrapV1
  const password = await readPassword(process.stdin)
  const receipt = await bootstrapFirstCloudOwnerV1(input, password)
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
}

async function readPassword(input: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of input) { const bytes = Buffer.from(chunk); size += bytes.byteLength; if (size > 258) throw new Error('cloud owner bootstrap credential is invalid'); chunks.push(bytes) }
  const bytes = Buffer.concat(chunks); let value = bytes.toString('utf8'); bytes.fill(0)
  value = value.replace(/\r?\n$/, '')
  if (!value || /[\r\n]/.test(value)) throw new Error('cloud owner bootstrap credential is invalid')
  return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('{"ok":false,"code":"cloud-owner-bootstrap-failed"}\n'); process.exitCode = 1 })
}
