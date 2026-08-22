import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalizeTaskResult, validateTaskPresentation } from '../packages/bridge-compat/src/dida-task-creator.js'

async function resultFiles(directory) {
  const results = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = resolve(directory, entry.name)
    if (entry.isDirectory()) results.push(...await resultFiles(pathname))
    else if (entry.isFile() && entry.name === 'result.json') results.push(pathname)
  }
  return results
}

function category(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown'
  if ('taskAction' in value || 'intakeDecision' in value || ('created' in value && 'title' in value)) return 'task-projection'
  if (Array.isArray(value.tasks) || 'totalActive' in value) return 'monitor'
  if ('deleted' in value || 'completedTaskIds' in value) return 'cleanup'
  if ('changes' in value && 'taskId' in value) return 'followup-update'
  return 'unknown'
}

function fingerprint(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12)
}

const root = process.argv[2]?.trim()
if (!root) {
  process.stderr.write('Usage: npm run replay:legacy-dida -- /absolute/legacy/var/dida [--strict]\n')
  process.exitCode = 2
} else {
  const allFiles = await resultFiles(resolve(root))
  const sinceIndex = process.argv.indexOf('--since')
  const sinceText = sinceIndex >= 0 ? process.argv[sinceIndex + 1] : undefined
  const since = sinceText ? new Date(sinceText) : undefined
  const minimumIndex = process.argv.indexOf('--min-task-projections')
  const minimumTaskProjections = minimumIndex >= 0 ? Number(process.argv[minimumIndex + 1]) : 0
  if (since && Number.isNaN(since.getTime())) throw new Error(`invalid --since timestamp: ${sinceText}`)
  if (!Number.isSafeInteger(minimumTaskProjections) || minimumTaskProjections < 0) throw new Error('invalid --min-task-projections value')
  const files = since
    ? (await Promise.all(allFiles.map(async (file) => ({ file, modifiedAt: (await stat(file)).mtime })))).filter((item) => item.modifiedAt >= since).map((item) => item.file)
    : allFiles
  const categories = new Map()
  const violations = new Map()
  const createdByTask = new Map()
  let parsed = 0
  let taskPassed = 0
  let taskFailed = 0
  for (const file of files) {
    let value
    try {
      value = JSON.parse(await readFile(file, 'utf8'))
      parsed += 1
    } catch {
      violations.set('invalid JSON result', (violations.get('invalid JSON result') || 0) + 1)
      continue
    }
    const type = category(value)
    categories.set(type, (categories.get(type) || 0) + 1)
    if (type !== 'task-projection') continue
    try {
      const normalized = normalizeTaskResult(value)
      validateTaskPresentation(normalized)
      taskPassed += 1
      if (normalized.taskAction === 'created' && normalized.taskId) {
        const key = fingerprint(normalized.taskId)
        createdByTask.set(key, (createdByTask.get(key) || 0) + 1)
      }
    } catch (error) {
      taskFailed += 1
      const message = String(error?.message || error).replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
      violations.set(message, (violations.get(message) || 0) + 1)
    }
  }
  const duplicateCreatedTaskFingerprints = [...createdByTask.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }))
  const report = {
    source: resolve(root),
    ...(since ? { since: since.toISOString() } : {}),
    discoveredFiles: allFiles.length,
    files: files.length,
    parsed,
    categories: Object.fromEntries([...categories.entries()].sort()),
    taskProjection: { passed: taskPassed, failed: taskFailed },
    minimumTaskProjections,
    violations: [...violations.entries()].sort((left, right) => right[1] - left[1]).map(([reason, count]) => ({ reason, count })),
    duplicateCreatedTaskFingerprints,
    externalWrites: 0,
    rawBusinessContentEmitted: false,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && (
    taskFailed > 0
    || taskPassed + taskFailed < minimumTaskProjections
    || duplicateCreatedTaskFingerprints.length > 0
    || parsed !== files.length
  )) {
    process.exitCode = 1
  }
}
