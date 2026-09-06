import { execFile, spawn } from 'node:child_process'
import { chmod, cp, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { sealServerDistribution } from '../src/control-plane/server-distribution.js'

const argv = process.argv.slice(2)
if (argv.length !== 6 || argv[0] !== '--output' || argv[2] !== '--version' || argv[4] !== '--revision') throw new Error('required exact arguments: --output --version --revision')
const output = argv[1]!; const version = argv[3]!; const revision = argv[5]!
const root = resolve(output); const sourceRoot = await realpath(new URL('..', import.meta.url).pathname)
if (!isAbsolute(output) || root !== output || await realpath(dirname(root)) !== dirname(root)) throw new Error('output must be a new canonical absolute path')
const command = promisify(execFile); const head = (await command('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim()
if (head !== revision) throw new Error('server distribution revision does not match HEAD')
const trackedStatus = (await command('git', ['status', '--porcelain', '--', 'src', 'migrations', 'scripts/build-server-distribution.ts'], { cwd: sourceRoot })).stdout
if (trackedStatus.trim()) throw new Error('server distribution inputs are not committed')
try { await lstat(root); throw new Error('output already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
try {
  await mkdir(join(root, 'program/dist/control-plane'), { recursive: true, mode: 0o700 }); await mkdir(join(root, 'program/dist/client-runtime'), { recursive: true, mode: 0o700 }); await mkdir(join(root, 'program/migrations/control-plane-sqlite'), { recursive: true, mode: 0o700 })
  await bundle(sourceRoot, 'src/control-plane/cloud-server-entry.ts', join(root, 'program/dist/control-plane/cloud-server-entry.js')); await bundle(sourceRoot, 'src/control-plane/server-admin-entry.ts', join(root, 'program/dist/control-plane/server-admin-entry.js')); await bundle(sourceRoot, 'src/client-runtime/ssh-subsystem-entry.ts', join(root, 'program/dist/client-runtime/ssh-subsystem-entry.js'))
  for (const name of ['001_tenant_identity.sql','002_agent_studio.sql','003_capability_registry.sql','004_device_sessions.sql','005_device_enrollment.sql','006_cloud_identity.sql','007_identity_administration.sql']) await cp(join(sourceRoot, 'migrations/control-plane-sqlite', name), join(root, 'program/migrations/control-plane-sqlite', name), { dereference: true })
  await writeFile(join(root, 'program/package.json'), `${JSON.stringify({ name: '@quarkfan/cloud-server-runtime', private: true, type: 'module', version }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(join(root, 'program/sbom.spdx.json'), `${JSON.stringify({ spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT', name: `QuarkSelfAI-Server-${version}`, documentNamespace: `https://quarkself.ai/spdx/server/${revision}`, creationInfo: { created: '1970-01-01T00:00:00Z', creators: ['Tool: QuarkSelfAI-server-distribution-v1'] }, packages: [] }, null, 2)}\n`, { mode: 0o600 })
  await makePrivate(root); const manifest = await sealServerDistribution(root, version, revision); process.stdout.write(`${JSON.stringify({ artifactDigest: manifest.artifactDigest, files: manifest.files.length, autoStart: false })}\n`)
} catch (error) { await rm(root, { recursive: true, force: true }); throw error }

function bundle(sourceRoot: string, source: string, destination: string): Promise<void> { return new Promise((resolveRun, rejectRun) => { const child = spawn(join(sourceRoot, 'node_modules/.bin/esbuild'), [source, '--bundle', '--platform=node', '--format=esm', '--target=node22', `--outfile=${destination}`, '--log-level=warning'], { cwd: sourceRoot, stdio: ['ignore','ignore','inherit'], shell: false }); child.once('error', rejectRun); child.once('close', code => code === 0 ? resolveRun() : rejectRun(new Error('server entry bundling failed'))) }) }
async function makePrivate(root: string): Promise<void> { async function visit(path: string): Promise<void> { const state = await lstat(path); if (state.isDirectory()) { await chmod(path, 0o700); const { readdir } = await import('node:fs/promises'); for (const name of await readdir(path)) await visit(join(path, name)) } else if (state.isFile()) await chmod(path, 0o600); else throw new Error('server distribution contains an unsupported file') }; await visit(root) }
