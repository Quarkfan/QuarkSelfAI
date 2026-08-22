import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

export interface LegacyStateSnapshot {
  readonly source: string
  readonly snapshot: string
  readonly bytes: number
  readonly sha256: string
  readonly sourceModifiedAt: string
  readonly reused: boolean
}

function hash(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

export async function snapshotLegacyState(sourcePath: string, destinationDirectory: string): Promise<LegacyStateSnapshot> {
  const source = resolve(sourcePath)
  const destination = resolve(destinationDirectory)
  const [contents, metadata] = await Promise.all([readFile(source), stat(source)])
  JSON.parse(contents.toString('utf8'))
  const sha256 = hash(contents)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  await access(destination, constants.R_OK | constants.W_OK)
  const snapshot = resolve(destination, `${basename(source, '.json')}-${sha256.slice(0, 16)}.json`)
  let reused = false
  try {
    await writeFile(snapshot, contents, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(snapshot)
    if (hash(existing) !== sha256) throw new Error(`existing snapshot ${snapshot} does not match its content-addressed name`)
    reused = true
  }
  const copied = await readFile(snapshot)
  if (copied.length !== contents.length || hash(copied) !== sha256) {
    throw new Error(`snapshot verification failed for ${snapshot}`)
  }
  return {
    source,
    snapshot,
    bytes: contents.length,
    sha256,
    sourceModifiedAt: metadata.mtime.toISOString(),
    reused,
  }
}
