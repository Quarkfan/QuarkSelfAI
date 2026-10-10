import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Narrow macOS adapter. It owns launchctl and definition-file I/O but no activation policy or tenant state. */
export class LaunchctlUserServiceManagerV1 {
  readonly platform = 'launchd-user' as const
  private readonly domain: string; private readonly service: string
  constructor(readonly label = 'com.quarkfan.quark-server', uid = process.getuid?.()) { if (!/^com\.quarkfan\.[a-z0-9.-]+$/.test(label) || uid === undefined || !Number.isSafeInteger(uid) || uid < 1) throw new Error('launchd service identity is invalid'); this.domain = `gui/${uid}`; this.service = `${this.domain}/${label}` }
  async installDefinition(sourcePath: string, targetPath: string, expectedDigest: string): Promise<void> { exactTarget(targetPath, `${this.label}.plist`); const source = await readRegular(sourcePath, 64 * 1024, true); if (digest(source) !== expectedDigest) throw new Error('server service source definition drifted'); try { const existing = await readRegular(targetPath, 64 * 1024, false); if (digest(existing) !== expectedDigest || !existing.equals(source)) throw new Error('server service target definition conflicts'); return } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }; const handle = await open(targetPath, 'wx', 0o600); try { await handle.writeFile(source); await handle.sync() } finally { await handle.close() } }
  async register(targetPath: string): Promise<void> { exactTarget(targetPath, `${this.label}.plist`); await command('/bin/launchctl', ['bootstrap', this.domain, targetPath], 'server service registration failed') }
  async start(): Promise<void> { if ((await this.inspect()).running) return; await command('/bin/launchctl', ['kickstart', this.service], 'server service start failed'); for (let attempt = 0; attempt < 50; attempt += 1) { if ((await this.inspect()).running) return; await delay(100) }; throw new Error('server service start failed') }
  async inspect(): Promise<{ readonly registered: boolean; readonly running: boolean }> { try { const result = await run('/bin/launchctl', ['print', this.service], { timeout: 10_000, maxBuffer: 256 * 1024 }); return { registered: true, running: /\bstate = running\b/.test(result.stdout) && /\bpid = \d+\b/.test(result.stdout) } } catch { return { registered: false, running: false } } }
  async stopAndUnregister(): Promise<void> { const status = await this.inspect(); if (status.registered) await command('/bin/launchctl', ['bootout', this.service], 'server service unregister failed') }
  async removeDefinition(targetPath: string, expectedDigest: string): Promise<void> { exactTarget(targetPath, `${this.label}.plist`); try { const bytes = await readRegular(targetPath, 64 * 1024, false); if (digest(bytes) !== expectedDigest) throw new Error('server service target definition drifted'); await unlink(targetPath) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
}

function exactTarget(path: string, name: string): void { if (!isAbsolute(path) || resolve(path) !== path || basename(path) !== name || /[\0\r\n]/.test(path)) throw new Error('server service definition target is invalid') }
async function readRegular(path: string, max: number, privateMode: boolean): Promise<Buffer> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (privateMode && (state.mode & 0o077) !== 0) || state.size < 1 || state.size > max || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('server service manager definition is unsafe'); return await readFile(path) }
async function command(file: string, args: readonly string[], message: string): Promise<void> { try { await run(file, [...args], { timeout: 15_000, maxBuffer: 256 * 1024 }) } catch { throw new Error(message) } }
function digest(bytes: Uint8Array): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
function delay(ms: number): Promise<void> { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)) }
