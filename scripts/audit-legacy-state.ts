import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const requested = process.argv[2]?.trim()
if (!requested) {
  process.stderr.write('Usage: npm run audit:legacy-state -- /absolute/path/to/state.json\n')
  process.exitCode = 2
} else {
  const filename = resolve(requested)
  const [contents, metadata] = await Promise.all([readFile(filename), stat(filename)])
  const state = JSON.parse(contents.toString('utf8')) as Record<string, unknown>
  const shape = Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key,
    Array.isArray(value)
      ? { kind: 'array', count: value.length }
      : value !== null && typeof value === 'object'
        ? { kind: 'object', keys: Object.keys(value as Record<string, unknown>).length }
        : { kind: typeof value },
  ]))
  process.stdout.write(`${JSON.stringify({
    file: filename,
    bytes: metadata.size,
    modifiedAt: metadata.mtime.toISOString(),
    sha256: createHash('sha256').update(contents).digest('hex'),
    topLevelShape: shape,
    readOnly: true,
  }, null, 2)}\n`)
}
