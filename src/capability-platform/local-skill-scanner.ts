import { createHash } from 'node:crypto'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { LocalSkillDescriptorV1 } from './discovery.js'

export interface LocalSkillRootV1 {
  readonly id: string
  readonly path: string
}

const MAX_ROOTS = 8
const MAX_SKILLS = 256
const MAX_FRONTMATTER_BYTES = 8192
const MAX_FILE_BYTES = 1024 * 1024
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

function field(lines: readonly string[], key: string): string {
  const matching = lines.filter(line => line.startsWith(`${key}:`))
  if (matching.length !== 1) throw new Error(`skill ${key} must appear exactly once`)
  let value = matching[0]!.slice(key.length + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  if (!value || value.includes('\0') || /[\r\n]/.test(value)) throw new Error(`skill ${key} is invalid`)
  return value
}

async function readFrontmatter(path: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw new Error('skill file is not a bounded regular file')
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(MAX_FRONTMATTER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const prefix = buffer.subarray(0, bytesRead).toString('utf8')
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(prefix)
    if (!match) throw new Error('skill frontmatter is missing or exceeds limit')
    return match[1]!
  } finally {
    await handle.close()
  }
}

/** Explicit-refresh metadata scan. Never reads references, scripts, or remote sources. */
export async function scanLocalSkillMetadata(roots: readonly LocalSkillRootV1[]): Promise<readonly LocalSkillDescriptorV1[]> {
  if (!Array.isArray(roots) || roots.length < 1 || roots.length > MAX_ROOTS) throw new Error('skill roots must contain 1-8 explicit roots')
  const seenRoots = new Set<string>()
  const seenPaths = new Set<string>()
  const descriptors: LocalSkillDescriptorV1[] = []
  for (const root of roots) {
    if (!SAFE_ID.test(root.id) || seenRoots.has(root.id)) throw new Error('skill root id is invalid or duplicate')
    if (typeof root.path !== 'string' || !isAbsolute(root.path)) throw new Error('skill root path must be absolute')
    seenRoots.add(root.id)
    const rootInfo = await lstat(root.path)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('skill root must be a real directory')
    const canonicalRoot = await realpath(root.path)
    if (seenPaths.has(canonicalRoot)) throw new Error('duplicate skill root path')
    seenPaths.add(canonicalRoot)
    const children = await readdir(canonicalRoot, { withFileTypes: true })
    if (children.length > MAX_SKILLS || descriptors.length + children.length > MAX_SKILLS) throw new Error('skill root exceeds scan limit')
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.isSymbolicLink()) throw new Error('skill root contains a symbolic link')
      if (!child.isDirectory()) continue
      if (!SAFE_ID.test(child.name)) throw new Error('skill directory name is invalid')
      const skillDir = join(canonicalRoot, child.name)
      if (await realpath(skillDir) !== skillDir) throw new Error('skill directory resolves outside its root')
      const skillPath = join(skillDir, 'SKILL.md')
      let info: Awaited<ReturnType<typeof lstat>>
      try { info = await lstat(skillPath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('skill file must be a real regular file')
      if (await realpath(skillPath) !== skillPath) throw new Error('skill file resolves outside its root')
      const frontmatter = await readFrontmatter(skillPath)
      const lines = frontmatter.split(/\r?\n/)
      const name = field(lines, 'name')
      const description = field(lines, 'description')
      if (name.length > 80 || description.length > 240) throw new Error('skill metadata exceeds display limit')
      const id = `${root.id}/${child.name}`
      descriptors.push(Object.freeze({
        id, name, description,
        digest: createHash('sha256').update(frontmatter).digest('hex'),
        detailRef: `local-skill:${id}`,
      }))
    }
  }
  return Object.freeze(descriptors)
}
