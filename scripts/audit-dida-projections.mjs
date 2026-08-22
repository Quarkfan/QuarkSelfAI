import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { normalizeTaskResult, validateTaskPresentation } from '../packages/bridge-compat/src/dida-task-creator.js'

async function resultFiles(directory) {
  const results = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = path.join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await resultFiles(pathname))
    else if (entry.isFile() && entry.name === 'result.json') results.push(pathname)
  }
  return results
}

function typeMatches(value, type) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  return typeof value === type
}

function validateSchema(value, schema, location = '$') {
  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (allowedTypes.length && !allowedTypes.some((type) => typeMatches(value, type))) {
    throw new Error(`${location}:type`)
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new Error(`${location}:enum`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${location}:minItems`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${location}:maxItems`)
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${location}[${index}]`))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const required = new Set(schema.required ?? [])
    for (const key of required) if (!(key in value)) throw new Error(`${location}.${key}:required`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) throw new Error(`${location}.${key}:additional`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) validateSchema(value[key], child, `${location}.${key}`)
    }
  }
}

function category(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && ('taskAction' in value || 'intakeDecision' in value || ('created' in value && 'title' in value))
    ? 'task-projection' : 'other'
}

function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

const didaRoot = process.argv[2]?.trim()
const statePath = process.argv[3]?.trim()
const minimumIndex = process.argv.indexOf('--min-task-projections')
const minimum = minimumIndex >= 0 ? Number(process.argv[minimumIndex + 1]) : 20
if (!didaRoot || !statePath || !Number.isSafeInteger(minimum) || minimum < 0) {
  process.stderr.write('Usage: npm run audit:dida-projections -- /absolute/var/dida /absolute/state.json [--min-task-projections 20] [--strict]\n')
  process.exitCode = 2
} else {
  const schemaPath = path.resolve('packages/bridge-compat/schemas/dida-task-result.schema.json')
  const [schema, state, files] = await Promise.all([
    readFile(schemaPath, 'utf8').then(JSON.parse),
    readFile(path.resolve(statePath), 'utf8').then(JSON.parse),
    resultFiles(path.resolve(didaRoot)),
  ])
  const decisions = Array.isArray(state.shadowDecisions) ? state.shadowDecisions : []
  const processed = new Set(Array.isArray(state.mentionProcessedMessageIds) ? state.mentionProcessedMessageIds : [])
  const correlated = []
  let taskProjectionFiles = 0
  let legacySchemaSkipped = 0
  const semanticFailures = new Map()
  for (const file of files) {
    let value
    try { value = JSON.parse(await readFile(file, 'utf8')) } catch { continue }
    if (category(value) !== 'task-projection') continue
    taskProjectionFiles += 1
    const suffix = path.basename(path.dirname(file)).split('-').at(-1)
    const decision = decisions.find((item) => processed.has(item.messageId)
      && item.messageId.endsWith(suffix)
      && item.taskAction === (value.taskAction === 'unchanged' && !value.taskId ? 'ignored' : value.taskAction)
      && (!value.taskId || item.taskId === value.taskId))
    if (!decision) continue
    try { validateSchema(value, schema) } catch { legacySchemaSkipped += 1; continue }
    try {
      const normalized = normalizeTaskResult(value)
      validateTaskPresentation(normalized)
      correlated.push({ messageId: decision.messageId, action: normalized.taskAction, modifiedAt: (await stat(file)).mtime })
    } catch (error) {
      const reason = String(error?.message || error).replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
      semanticFailures.set(reason, (semanticFailures.get(reason) ?? 0) + 1)
    }
  }
  const unique = new Map(correlated.map((item) => [item.messageId, item]))
  const actionDistribution = {}
  for (const item of unique.values()) actionDistribution[item.action] = (actionDistribution[item.action] ?? 0) + 1
  const dates = [...unique.values()].map((item) => item.modifiedAt).sort((left, right) => left - right)
  const duplicates = [...correlated.reduce((map, item) => map.set(item.messageId, (map.get(item.messageId) ?? 0) + 1), new Map())]
    .filter(([, count]) => count > 1).map(([messageId, count]) => ({ message: fingerprint(messageId), count }))
  const report = {
    sourceFiles: files.length,
    taskProjectionFiles,
    shadowDecisions: decisions.length,
    processedMessages: processed.size,
    exactSchemaAccepted: unique.size,
    minimumTaskProjections: minimum,
    actionDistribution,
    ...(dates.length ? { acceptedWindow: { earliest: dates[0].toISOString(), latest: dates.at(-1).toISOString() } } : {}),
    legacySchemaSkipped,
    semanticFailures: [...semanticFailures].map(([reason, count]) => ({ reason, count })),
    duplicateAcceptedMessageFingerprints: duplicates,
    lineage: 'result.json -> processed message -> shadow decision',
    externalWrites: 0,
    rawBusinessContentEmitted: false,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && (unique.size < minimum || semanticFailures.size > 0 || duplicates.length > 0)) {
    process.exitCode = 1
  }
}
