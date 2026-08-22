import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

function contains(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export class WorkspacePolicy {
  private constructor(private readonly roots: readonly string[]) {}

  static async create(configuredRoots: readonly string[]): Promise<WorkspacePolicy> {
    if (configuredRoots.length === 0) throw new Error('at least one local workspace root is required')
    const roots = await Promise.all(configuredRoots.map(async (root) => {
      const canonical = await realpath(resolve(root))
      if (canonical === '/') throw new Error('the filesystem root cannot be used as a workspace root')
      return canonical
    }))
    return new WorkspacePolicy([...new Set(roots)])
  }

  count(): number {
    return this.roots.length
  }

  async authorizeExisting(target: string): Promise<string> {
    const canonical = await realpath(resolve(target))
    if (!this.roots.some((root) => contains(root, canonical))) {
      throw new Error(`local path is outside the configured workspace roots: ${target}`)
    }
    return canonical
  }

  async authorizeCreation(target: string): Promise<string> {
    const absolute = resolve(target)
    const parent = await realpath(dirname(absolute))
    if (!this.roots.some((root) => contains(root, parent))) {
      throw new Error(`local path is outside the configured workspace roots: ${target}`)
    }
    return resolve(parent, basename(absolute))
  }
}
