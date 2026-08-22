import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const projectRoot = process.cwd()
const checkout = resolve(projectRoot, process.env.DSH_CHECKOUT ?? '../deepseek-harness')
const home = resolve(projectRoot, process.env.DSH_HOME ?? 'var/dsh')
const profile = process.env.DSH_PROFILE?.trim() || 'feishu-assistant'
const baseline = JSON.parse(await readFile(resolve(projectRoot, 'compat/dsh-baseline.json'), 'utf8')) as {
  version: string
  sourceCommit: string
}
const manifest = JSON.parse(await readFile(resolve(checkout, 'apps/cli/package.json'), 'utf8')) as { version?: string }
if (manifest.version !== baseline.version) {
  throw new Error(`DSH checkout version ${String(manifest.version)} does not match baseline ${baseline.version}`)
}
const { stdout: revision } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout })
if (revision.trim() !== baseline.sourceCommit) {
  throw new Error(`DSH checkout commit ${revision.trim()} does not match baseline ${baseline.sourceCommit}`)
}
await exec('corepack', [
  'pnpm', 'dsh', 'plugin', '--profile', profile, 'add', `link:${projectRoot}`,
], {
  cwd: checkout,
  env: { ...process.env, DSH_HOME: home },
  maxBuffer: 4 * 1024 * 1024,
})
const profileManifestPath = resolve(home, 'profiles', profile, 'package.json')
const profileManifest = JSON.parse(await readFile(profileManifestPath, 'utf8')) as {
  dsh?: { profile?: { bundles?: string[] } }
}
const bundles = profileManifest.dsh?.profile?.bundles
if (!Array.isArray(bundles)) throw new Error(`DSH profile ${profile} has no bundle list`)
profileManifest.dsh = profileManifest.dsh ?? {}
profileManifest.dsh.profile = profileManifest.dsh.profile ?? {}
profileManifest.dsh.profile.bundles = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@quarkfan/quark-self-ai',
]
await writeFile(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`DSH profile ready profile=${profile} home=${home} baseline=${baseline.version}@${baseline.sourceCommit}\n`)
