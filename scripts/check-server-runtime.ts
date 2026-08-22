import assert from 'node:assert/strict'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const runtimeRoot = resolve(root, 'deploy/dsh-runtime')
const manifest = JSON.parse(await readFile(resolve(runtimeRoot, 'package.json'), 'utf8')) as {
  packageManager?: string
  dependencies?: Record<string, string>
}
const expected = {
  '@deepseek-ai/dsh': '0.1.1-rc.2',
  '@deepseek-ai/dsh-subagent-claude-code': '0.1.1-rc.2',
  '@deepseek-ai/dsh-subagent-codex': '0.1.1-rc.2',
}
assert.equal(manifest.packageManager, 'pnpm@11.7.0')
assert.deepEqual(manifest.dependencies, expected)

const lock = await readFile(resolve(runtimeRoot, 'pnpm-lock.yaml'), 'utf8')
for (const [name, version] of Object.entries(expected)) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(lock, new RegExp(`['"]?${escapedName}['"]?:\\s+specifier: ${escapedVersion}\\s+version: ${escapedVersion}(?:\\(|\\s)`))
}
const workspace = await readFile(resolve(runtimeRoot, 'pnpm-workspace.yaml'), 'utf8')
assert.match(workspace, /nodeLinker: hoisted/)
assert.match(workspace, /autoInstallPeers: true/)

const dockerfile = await readFile(resolve(root, 'Dockerfile'), 'utf8')
assert.match(dockerfile, /ARG PNPM_VERSION=11\.7\.0/)
assert.match(dockerfile, /COPY deploy\/dsh-runtime\/package\.json deploy\/dsh-runtime\/pnpm-lock\.yaml/)
assert.match(dockerfile, /pnpm install --prod --frozen-lockfile --ignore-scripts/)
assert.match(dockerfile, /DSH_EXECUTABLE="\/opt\/dsh-runtime\/node_modules\/\.bin\/dsh"/)
assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/quark-self-ai-entrypoint"\]/)
assert.doesNotMatch(dockerfile, /ASSISTANT_KERNEL=off/)

const entrypointPath = resolve(root, 'deploy/container-entrypoint.sh')
await access(entrypointPath, constants.X_OK)
const entrypoint = await readFile(entrypointPath, 'utf8')
assert.match(entrypoint, /dsh plugin --profile|"\$\{dsh_executable\}" plugin --profile/)
assert.match(entrypoint, /link:\$\{project_root\}/)
assert.match(entrypoint, /exec node dist\/app\.js/)
const mode = (await stat(entrypointPath)).mode & 0o777
assert.equal(mode, 0o755)

process.stdout.write('Server DSH runtime closure verified manager=pnpm@11.7.0 dsh=0.1.1-rc.2 providers=2\n')
