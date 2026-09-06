import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const maxInputBytes = 256 * 1024
const dshBin = fileURLToPath(new URL('../../node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url))
const inferencePatch = fileURLToPath(new URL('../../config/dsh-inference-provider.patch.yml', import.meta.url))
const noEffectPatch = fileURLToPath(new URL('../../config/dsh-reasoning-only.patch.yml', import.meta.url))

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk)
    size += bytes.byteLength
    if (size > maxInputBytes) throw new Error('dsh stdin host input exceeds the fixed bound')
    chunks.push(bytes)
  }
  const value = Buffer.concat(chunks).toString('utf8')
  for (const chunk of chunks) chunk.fill(0)
  if (!value.trim() || value.includes('\0')) throw new Error('dsh stdin host input is invalid')
  return value
}

const task = await readBoundedStdin()
await Promise.all([readFile(inferencePatch, 'utf8'), readFile(noEffectPatch, 'utf8')])
const actionHome = await realpath(await mkdtemp(join(process.cwd(), 'dsh-action-')))
process.env.DSH_HOME = actionHome
try {
  process.argv = [process.execPath, dshBin, '--profile', 'headless', '--patch', inferencePatch, '--patch', noEffectPatch, task]
  await import(pathToFileURL(dshBin).href)
} finally {
  await rm(actionHome, { recursive: true, force: true })
}
