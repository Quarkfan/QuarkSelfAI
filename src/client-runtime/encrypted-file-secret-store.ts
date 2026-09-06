import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, lstat, mkdir, open, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { RemovableLocalDeviceSecretStoreV1 } from './contracts.js'

const referencePattern = /^secret:[a-z0-9][a-z0-9._:-]{0,127}$/
const maxSecretBytes = 64 * 1024
const maxRecordBytes = 128 * 1024
const aadDomain = 'quark-device-secret-v1\0'
interface EncryptedSecretRecordV1 { readonly schemaVersion: 1; readonly algorithm: 'aes-256-gcm'; readonly referenceDigest: string; readonly iv: string; readonly tag: string; readonly ciphertext: string }

/** Persistent local secret store. The 32-byte master key is injected and never written by this adapter. */
export class EncryptedFileDeviceSecretStoreV1 implements RemovableLocalDeviceSecretStoreV1 {
  private closed = false
  private constructor(private readonly root: string, private readonly masterKey: Buffer) {}

  static async open(rootInput: string, masterKeyInput: Uint8Array): Promise<EncryptedFileDeviceSecretStoreV1> {
    if (!isAbsolute(rootInput) || masterKeyInput.byteLength !== 32) throw new Error('encrypted secret store requires an absolute root and a 32-byte master key')
    const requested = resolve(rootInput); await mkdir(requested, { recursive: true, mode: 0o700 })
    const requestedInfo = await lstat(requested)
    if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) throw new Error('encrypted secret store root must not be a symbolic link')
    const root = await realpath(requested); await chmod(root, 0o700)
    await validateRoot(root)
    return new EncryptedFileDeviceSecretStoreV1(root, Buffer.from(masterKeyInput))
  }

  async put(reference: string, value: Uint8Array): Promise<void> {
    this.#requireOpen(); validateReference(reference)
    if (!value.byteLength || value.byteLength > maxSecretBytes) throw new Error('device secret size is invalid')
    await validateRoot(this.root)
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv); cipher.setAAD(Buffer.from(`${aadDomain}${reference}`))
    const plaintext = Buffer.from(value)
    try {
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]); const record: EncryptedSecretRecordV1 = { schemaVersion: 1, algorithm: 'aes-256-gcm', referenceDigest: referenceDigest(reference), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') }
      const path = this.#path(reference); const temporary = `${path}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
        try { await link(temporary, path) } catch (error) { if (hasCode(error, 'EEXIST')) throw new Error('device secret reference already exists'); throw error }
      } finally { await rm(temporary, { force: true }) }
    } finally { plaintext.fill(0) }
  }

  async get(reference: string): Promise<Uint8Array | undefined> {
    this.#requireOpen(); validateReference(reference); await validateRoot(this.root); const path = this.#path(reference)
    let handle
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) } catch (error) { if (hasCode(error, 'ENOENT')) return undefined; if (hasCode(error, 'ELOOP')) throw new Error('encrypted device secret record is unsafe'); throw error }
    let text: string
    try { const info = await handle.stat(); if (!info.isFile() || info.size > maxRecordBytes) throw new Error('encrypted device secret record is unsafe'); text = await handle.readFile('utf8') } finally { await handle.close() }
    const record = parseRecord(text, reference)
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(record.iv, 'base64url')); decipher.setAAD(Buffer.from(`${aadDomain}${reference}`)); decipher.setAuthTag(Buffer.from(record.tag, 'base64url'))
      const value = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64url')), decipher.final()])
      if (!value.byteLength || value.byteLength > maxSecretBytes) { value.fill(0); throw new Error('decrypted device secret size is invalid') }
      const output = Uint8Array.from(value); value.fill(0); return output
    } catch { throw new Error('encrypted device secret authentication failed') }
  }

  async remove(reference: string): Promise<boolean> {
    this.#requireOpen(); validateReference(reference); await validateRoot(this.root); const path = this.#path(reference)
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('encrypted device secret record is unsafe'); await rm(path); return true }
    catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error }
  }

  close(): void { if (!this.closed) { this.masterKey.fill(0); this.closed = true } }
  #path(reference: string): string { return join(this.root, `${referenceDigest(reference).slice(7)}.json`) }
  #requireOpen(): void { if (this.closed) throw new Error('encrypted device secret store is closed') }
}

function validateReference(reference: string): void { if (!referencePattern.test(reference)) throw new Error('encrypted device secret reference is invalid') }
function referenceDigest(reference: string): string { return `sha256:${createHash('sha256').update(reference).digest('hex')}` }
async function validateRoot(root: string): Promise<void> { const info = await lstat(root); if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root || (info.mode & 0o077) !== 0) throw new Error('encrypted secret store root must be a private real directory') }
function parseRecord(text: string, reference: string): EncryptedSecretRecordV1 {
  let value: unknown; try { value = JSON.parse(text) } catch { throw new Error('encrypted device secret record is invalid') }
  const record = value as Partial<EncryptedSecretRecordV1>; const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as object).sort() : []
  if (keys.join(',') !== 'algorithm,ciphertext,iv,referenceDigest,schemaVersion,tag' || record.schemaVersion !== 1 || record.algorithm !== 'aes-256-gcm' || record.referenceDigest !== referenceDigest(reference) || typeof record.iv !== 'string' || Buffer.from(record.iv, 'base64url').byteLength !== 12 || typeof record.tag !== 'string' || Buffer.from(record.tag, 'base64url').byteLength !== 16 || typeof record.ciphertext !== 'string') throw new Error('encrypted device secret record is invalid')
  return record as EncryptedSecretRecordV1
}
function hasCode(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === code }
