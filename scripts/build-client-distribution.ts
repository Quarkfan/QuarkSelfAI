import { spawn } from 'node:child_process'
import { cp, chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { sealClientDistribution } from '../src/client-runtime/client-distribution.js'

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) { const name = process.argv[index]; const value = process.argv[index + 1]; if (name?.startsWith('--') && value) args.set(name.slice(2), value) }
const output = args.get('output'); const version = args.get('version'); const revision = args.get('revision')
if (!output || !version || !revision) throw new Error('required arguments: --output --version --revision')
const root = resolve(output); const projectRoot = realpath(new URL('..', import.meta.url).pathname)
if (!isAbsolute(output) || root !== output || await realpath(dirname(root)) !== dirname(root)) throw new Error('output must be a new canonical absolute path')
try { await lstat(root); throw new Error('output already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await mkdir(join(root, 'program/dist/client-runtime'), { recursive: true, mode: 0o700 })
  await mkdir(join(root, 'program/config'), { recursive: true, mode: 0o700 })
  await mkdir(join(root, 'program/migrations/client-sqlite'), { recursive: true, mode: 0o700 })
try {
  const sourceRoot = await projectRoot
  await runEsbuild(sourceRoot, 'src/client-runtime/client-entry.ts', join(root, 'program/dist/client-runtime/client-entry.js'))
  await runEsbuild(sourceRoot, 'src/client-runtime/client-installer-entry.ts', join(root, 'program/dist/client-runtime/client-installer-entry.js'))
  for (const [source, destination] of [
    ['dist/client-runtime/dsh-stdin-host.js', 'program/dist/client-runtime/dsh-stdin-host.js'],
    ['config/dsh-baseline.json', 'program/config/dsh-baseline.json'],
    ['config/dsh-inference-provider.patch.yml', 'program/config/dsh-inference-provider.patch.yml'],
    ['config/dsh-reasoning-only.patch.yml', 'program/config/dsh-reasoning-only.patch.yml'],
    ['migrations/client-sqlite/001_client_state.sql', 'program/migrations/client-sqlite/001_client_state.sql'],
  ] as const) await cp(join(sourceRoot, source), join(root, destination), { dereference: true })
  const baseline = JSON.parse(await readFile(join(sourceRoot, 'config/dsh-baseline.json'), 'utf8')) as { fallbackRuntimePackages?: Record<string, string> }
  const roots = Object.keys(baseline.fallbackRuntimePackages ?? {})
  const packages = await runtimeClosure(sourceRoot, roots)
  for (const name of packages) { const destination = join(root, 'program/node_modules', name); await mkdir(dirname(destination), { recursive: true, mode: 0o700 }); await cp(join(sourceRoot, 'node_modules', name), destination, { recursive: true, dereference: true }) }
  const manifests = await Promise.all(packages.map(async name => ({ name, value: JSON.parse(await readFile(join(sourceRoot, 'node_modules', name, 'package.json'), 'utf8')) as { version: string; license?: unknown } })))
  await writeFile(join(root, 'program/package.json'), `${JSON.stringify({ name: '@quarkfan/local-client-runtime', private: true, type: 'module', version, dependencies: Object.fromEntries(manifests.map(({ name, value }) => [name, value.version])) }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(join(root, 'program/sbom.spdx.json'), `${JSON.stringify({ spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT', name: `QuarkSelfAI-Client-${version}`, documentNamespace: `https://quarkself.ai/spdx/client/${revision}`, creationInfo: { created: '1970-01-01T00:00:00Z', creators: ['Tool: QuarkSelfAI-client-distribution-v1'] }, packages: manifests.map(({ name, value }) => ({ name, SPDXID: `SPDXRef-Package-${name.replace(/[^A-Za-z0-9.-]/g, '-')}`, versionInfo: value.version, licenseConcluded: 'NOASSERTION', licenseDeclared: typeof value.license === 'string' ? value.license : 'NOASSERTION', downloadLocation: 'NOASSERTION', filesAnalyzed: false })) }, null, 2)}\n`, { mode: 0o600 })
  await makePrivate(root)
  const manifest = await sealClientDistribution(root, version, revision)
  process.stdout.write(`${JSON.stringify({ artifactDigest: manifest.artifactDigest, files: manifest.files.length, packages: packages.length })}\n`)
} catch (error) {
  const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); throw error
}

async function runEsbuild(sourceRoot: string, source: string, destination: string): Promise<void> { await new Promise<void>((accept, reject) => { const child = spawn(join(sourceRoot, 'node_modules/.bin/esbuild'), [source, '--bundle', '--platform=node', '--format=esm', '--target=node22', `--outfile=${destination}`, '--log-level=warning'], { cwd: sourceRoot, stdio: ['ignore', 'ignore', 'inherit'], shell: false }); child.once('error', reject); child.once('close', code => code === 0 ? accept() : reject(new Error('client entry bundling failed'))) }) }
async function runtimeClosure(root: string, initial: readonly string[]): Promise<readonly string[]> { const found = new Set<string>(); const pending = [...initial]; while (pending.length) { const name = pending.shift()!; if (found.has(name)) continue; const manifest = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }; found.add(name); for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).sort()) { try { await lstat(join(root, 'node_modules', dependency, 'package.json')); pending.push(dependency) } catch { /* platform-optional dependency absent */ } } } return [...found].sort() }
async function makePrivate(root: string): Promise<void> { async function visit(path: string): Promise<void> { const state = await lstat(path); if (state.isDirectory()) { await chmod(path, 0o700); const { readdir } = await import('node:fs/promises'); for (const name of await readdir(path)) await visit(join(path, name)) } else if (state.isFile()) await chmod(path, (state.mode & 0o100) !== 0 ? 0o700 : 0o600); else throw new Error('client distribution contains an unsupported file') } await visit(root) }
