import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const liveRoot = resolve(projectRoot, process.env.LIVE_BRIDGE_ROOT ?? '../../codex-lark-bridge')
const compatRoot = resolve(projectRoot, 'packages/bridge-compat')
const baselinePath = resolve(projectRoot, 'compat/bridge-live-baseline.json')
const selectedRoots = ['src', 'schemas']
const selectedFiles = ['package.json']
const allowedDifferences = new Set([
  'package.json',
  'src/bridge.js',
  'src/codex-bridge-mcp.js',
  'src/codex-runner.js',
  'src/index.js',
  'src/lark-card.js',
  'src/mention-monitor.js',
])
const allowedCompatOnly = new Set(['src/quark-control-plane-client.js'])

async function files(root: string): Promise<string[]> {
  const result = [...selectedFiles]
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else result.push(path)
    }
  }
  for (const directory of selectedRoots) await visit(directory)
  return result.sort()
}

async function snapshot(root: string): Promise<{ hash: string; paths: readonly string[]; contents: ReadonlyMap<string, Buffer> }> {
  const paths = await files(root)
  const contents = new Map<string, Buffer>()
  const digest = createHash('sha256')
  for (const path of paths) {
    const value = await readFile(join(root, path))
    contents.set(path, value)
    digest.update(path).update('\0').update(value).update('\0')
  }
  return { hash: digest.digest('hex'), paths, contents }
}

const [live, compat] = await Promise.all([snapshot(liveRoot), snapshot(compatRoot)])
const livePaths = new Set(live.paths)
const compatPaths = new Set(compat.paths)
const liveOnly = live.paths.filter((path) => !compatPaths.has(path))
const compatOnly = compat.paths.filter((path) => !livePaths.has(path))
const differences = live.paths.filter((path) => {
  const other = compat.contents.get(path)
  return other !== undefined && !live.contents.get(path)?.equals(other)
})
const current = {
  liveHash: live.hash,
  compatHash: compat.hash,
  liveFileCount: live.paths.length,
  compatFileCount: compat.paths.length,
  differences,
  liveOnly,
  compatOnly,
}
if (process.argv.includes('--current')) {
  process.stdout.write(`${JSON.stringify(current, null, 2)}\n`)
} else {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as typeof current
  assert.equal(live.hash, baseline.liveHash, 'live bridge changed after the compatibility baseline; resync and re-audit before takeover')
  assert.equal(compat.hash, baseline.compatHash, 'compatibility provider changed after the audited baseline')
  assert.deepEqual(differences, [...allowedDifferences].sort(), 'unexpected live/compat file differences')
  assert.deepEqual(liveOnly, [], 'live bridge contains files missing from the compatibility provider')
  assert.deepEqual(compatOnly, [...allowedCompatOnly].sort(), 'compatibility provider contains unreviewed extra files')
  process.stdout.write(`${JSON.stringify({
    compatible: true,
    liveHash: live.hash,
    compatHash: compat.hash,
    commonFileCount: live.paths.length,
    reviewedDifferences: differences,
    additiveCompatFiles: compatOnly,
    liveBusinessContentEmitted: false,
  }, null, 2)}\n`)
}
