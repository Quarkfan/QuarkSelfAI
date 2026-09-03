import { spawn } from 'node:child_process'
import type { WorkJournalConfig } from './config.js'
import type { WorkJournalEvidenceProvider } from './contract.js'

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 180_000
const CHAT_BATCH_SIZE = 50
const MAX_SELECTED_MESSAGES = 600

export interface FeishuSearchResult {
  readonly messages: readonly Readonly<Record<string, unknown>>[]
  readonly total: number
  readonly complete: boolean
}

export type FeishuSearchRunner = (args: readonly string[], signal?: AbortSignal) => Promise<FeishuSearchResult>

function compact(value: unknown, maximum = 2_000): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
  return text.replace(/\s+/gu, ' ').trim().slice(0, maximum)
}

function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) throw new Error('Feishu search did not return JSON')
  let depth = 0; let quoted = false; let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1))
  }
  throw new Error('Feishu search returned incomplete JSON')
}

function parseSearchResult(stdout: string): FeishuSearchResult {
  const envelope = firstJsonObject(stdout) as Record<string, unknown>
  if (envelope.ok !== true || envelope.identity !== 'user') throw new Error('Feishu user search was not successful')
  const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown> : {}
  const messages = Array.isArray(data.messages)
    ? data.messages.filter(message => message && typeof message === 'object' && !Array.isArray(message)) as readonly Readonly<Record<string, unknown>>[]
    : []
  const total = Number.isFinite(Number(data.total)) ? Math.max(messages.length, Number(data.total)) : messages.length
  return { messages, total, complete: data.has_more !== true }
}

function command(config: WorkJournalConfig, args: readonly string[], signal?: AbortSignal): Promise<FeishuSearchResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.larkCli, ['im', '+messages-search', ...args], {
      cwd: config.workspace,
      env: { ...process.env, CODEX_NOTIFY_ON_ERROR: 'false', CODEX_NOTIFY_ON_COMPLETE: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''; let stderr = ''; let bytes = 0; let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else {
        try { resolve(parseSearchResult(stdout)) } catch (parseError) { reject(parseError) }
      }
    }
    const abort = (): void => { child.kill('SIGTERM'); finish(new Error('Feishu search aborted')) }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Feishu search timed out')) }, SEARCH_TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (bytes > MAX_OUTPUT_BYTES) { child.kill('SIGTERM'); finish(new Error('Feishu search exceeded output limit')); return }
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-4_000) })
    child.on('error', error => finish(error))
    child.on('exit', code => finish(code === 0 ? undefined : new Error(`Feishu search exited ${String(code)}: ${compact(stderr, 500)}`)))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

function chunks<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function chatId(message: Readonly<Record<string, unknown>>): string { return compact(message.chat_id, 100) }
function messageId(message: Readonly<Record<string, unknown>>): string { return compact(message.message_id, 100) }
function createdAt(message: Readonly<Record<string, unknown>>): string { return compact(message.create_time, 100) }

function selectedContext(
  context: readonly Readonly<Record<string, unknown>>[],
  anchors: ReadonlySet<string>,
): readonly Readonly<Record<string, unknown>>[] {
  const grouped = new Map<string, Readonly<Record<string, unknown>>[]>()
  for (const message of context) {
    const id = chatId(message)
    if (!id) continue
    const group = grouped.get(id) ?? []
    group.push(message); grouped.set(id, group)
  }
  const selected: Readonly<Record<string, unknown>>[] = []
  for (const messages of grouped.values()) {
    messages.sort((left, right) => createdAt(left).localeCompare(createdAt(right)))
    const indexes = new Set<number>()
    messages.forEach((message, index) => {
      if (anchors.has(messageId(message))) for (let offset = -2; offset <= 2; offset += 1) indexes.add(index + offset)
    })
    for (const index of [...indexes].sort((left, right) => left - right)) {
      const message = messages[index]
      if (!message || selected.length >= MAX_SELECTED_MESSAGES) continue
      const sender = message.sender && typeof message.sender === 'object' && !Array.isArray(message.sender)
        ? message.sender as Record<string, unknown> : {}
      selected.push({
        messageId: messageId(message), at: createdAt(message), chatId: chatId(message),
        chatType: compact(message.chat_type, 40), chatName: compact(message.chat_partner, 200),
        senderName: compact(sender.name, 120), senderId: compact(sender.id ?? sender.open_id, 100),
        messageType: compact(message.msg_type, 40), content: compact(message.content),
        link: compact(message.message_app_link, 500), anchor: anchors.has(messageId(message)),
      })
    }
  }
  return selected
}

function errorReason(reason: unknown): string {
  return reason instanceof Error ? compact(reason.message, 300) : compact(reason, 300)
}

export class FeishuWorkEvidenceProvider implements WorkJournalEvidenceProvider {
  private readonly runner: FeishuSearchRunner

  constructor(
    private readonly base: WorkJournalEvidenceProvider,
    private readonly config: WorkJournalConfig,
    runner?: FeishuSearchRunner,
  ) {
    this.runner = runner ?? ((args, signal) => command(config, args, signal))
  }

  async load(day: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    const local = await this.base.load(day, signal)
    if (!this.config.ownerOpenId) return {
      ...local,
      feishuDaily: { status: 'not-configured', coverage: { reason: 'QUARK_OWNER_OPEN_ID is not configured' }, messages: [] },
    }
    const common = ['--as', 'user', '--query', '', '--start', `${day}T00:00:00+08:00`, '--end', `${day}T23:59:59+08:00`, '--page-size', '50', '--page-all', '--no-reactions', '--format', 'json']
    const [ownerResult, mentionResult] = await Promise.allSettled([
      this.runner([...common, '--sender', this.config.ownerOpenId], signal),
      this.runner([...common, '--is-at-me'], signal),
    ])
    const owner = ownerResult.status === 'fulfilled' ? ownerResult.value : undefined
    const mentions = mentionResult.status === 'fulfilled' ? mentionResult.value : undefined
    const anchorMessages = [...(owner?.messages ?? []), ...(mentions?.messages ?? [])]
    const chatIds = [...new Set(anchorMessages.map(chatId).filter(Boolean))]
    const contextResults: FeishuSearchResult[] = []
    const contextErrors: string[] = []
    for (const batch of chunks(chatIds, CHAT_BATCH_SIZE)) {
      try { contextResults.push(await this.runner([...common, '--chat-id', batch.join(',')], signal)) }
      catch (error) { contextErrors.push(errorReason(error)) }
    }
    const contextMessages = contextResults.flatMap(result => result.messages)
    const anchors = new Set(anchorMessages.map(messageId).filter(Boolean))
    const ownerComplete = owner?.complete === true
    const mentionsComplete = mentions?.complete === true
    const contextComplete = chatIds.length === 0
      ? ownerResult.status === 'fulfilled' && mentionResult.status === 'fulfilled'
      : contextErrors.length === 0 && contextResults.every(result => result.complete)
    const allFailed = ownerResult.status === 'rejected' && mentionResult.status === 'rejected'
    const status = allFailed ? 'unavailable' : ownerComplete && mentionsComplete && contextComplete ? 'available' : 'partial'
    const messages = selectedContext(contextMessages, anchors)
    return {
      ...local,
      feishuDaily: {
        status,
        coverage: {
          ownerSent: { count: owner?.messages.length ?? 0, total: owner?.total ?? 0, complete: ownerComplete, error: ownerResult.status === 'rejected' ? errorReason(ownerResult.reason) : undefined },
          mentions: { count: mentions?.messages.length ?? 0, total: mentions?.total ?? 0, complete: mentionsComplete, error: mentionResult.status === 'rejected' ? errorReason(mentionResult.reason) : undefined },
          relatedChats: chatIds.length,
          context: { count: contextMessages.length, total: contextResults.reduce((sum, result) => sum + result.total, 0), complete: contextComplete, errors: contextErrors },
          selectedMessages: messages.length,
        },
        messages,
      },
    }
  }
}
