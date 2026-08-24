import type { Context } from '@deepseek-ai/cordis'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { FOCUS_DISCOVERY_EVENT_KEY, INTAKE_EFFECTS, type FocusDiscoverySources } from '../intake/types.js'
import type {} from '../storage/service-contract.js'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type {} from '../workflow/runtime.js'
import { isRecord } from './json.js'
import { ProcessCommandRunner, runJson, type CommandRunner } from './runner.js'

export interface FeishuFocusDiscoveryEffectConfig {
  readonly executable?: string
  readonly searchPageLimit?: number
  readonly flagPageLimit?: number
  readonly feedPageLimit?: number
}

export interface FocusEventAppender {
  appendEvent(event: NormalizedChannelEvent): Promise<{ readonly inserted: boolean }>
}

type Candidate = { readonly message: Readonly<Record<string, unknown>>; readonly reasons: readonly string[] }

/** Read-only Feishu discovery adapter. It can only journal bounded, normalized candidates. */
export class FeishuFocusDiscoveryEffectAdapter {
  constructor(
    private readonly config: FeishuFocusDiscoveryEffectConfig,
    private readonly state: FocusEventAppender,
    private readonly runner: CommandRunner = new ProcessCommandRunner(),
  ) {}

  async execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    if (effect.kind !== INTAKE_EFFECTS.discoverSignals) throw new Error(`unsupported Feishu discovery effect ${effect.kind}`)
    const from = timestamp(effect.payload.from, 'focus discovery from')
    const until = timestamp(effect.payload.until, 'focus discovery until')
    if (from.getTime() >= until.getTime()) throw new Error('focus discovery window must be increasing')
    const sources = sourcesOf(effect.payload.sources)

    const candidates = new Map<string, { message: Readonly<Record<string, unknown>>; reasons: Set<string> }>()
    const focusChats = new Map<string, Set<string>>()
    for (const chatId of sources.conversationIds) addReason(focusChats, chatId, 'configured-conversation')

    if (sources.includeFlaggedConversations) {
      const flags = await this.flaggedCandidates()
      for (const candidate of flags.messages) mergeCandidate(candidates, candidate)
      for (const chatId of flags.chatIds) addReason(focusChats, chatId, 'flagged-conversation')
    }

    for (const chatId of await this.feedGroupChats(sources.feedGroupNames)) addReason(focusChats, chatId, 'focus-feed-group')

    const senderReasons = new Map<string, Set<string>>()
    for (const senderId of sources.senderIds) addReason(senderReasons, senderId, 'configured-sender')
    if (sources.includeOwnerParticipation) addReason(senderReasons, sources.ownerOpenId, 'owner-participation')

    const [senderMessages, chatMessages, directMessages, mentionMessages] = await Promise.all([
      this.searchMessages('sender', [...senderReasons.keys()], from, until),
      this.searchMessages('chat', [...focusChats.keys()], from, until),
      sources.includeDirectMessages ? this.searchMessages('direct', [], from, until) : [],
      sources.includeMentionBackfill ? this.searchMessages('mention', [], from, until) : [],
    ])
    for (const message of senderMessages) {
      const senderId = messageSenderId(message)
      mergeCandidate(candidates, { message, reasons: senderId ? [...(senderReasons.get(senderId) ?? [])] : [] })
    }
    for (const message of chatMessages) {
      const chatId = optionalText(message.chat_id ?? message.chatId, 300)
      mergeCandidate(candidates, { message, reasons: chatId ? [...(focusChats.get(chatId) ?? [])] : [] })
    }
    for (const message of directMessages) mergeCandidate(candidates, { message, reasons: ['direct-message'] })
    for (const message of mentionMessages) mergeCandidate(candidates, { message, reasons: ['mention-backfill'] })

    let inserted = 0
    let duplicate = 0
    let skipped = 0
    for (const candidate of candidates.values()) {
      const event = normalizeDiscoveredMessage(candidate.message, [...candidate.reasons].sort())
      if (!event) { skipped += 1; continue }
      const result = await this.state.appendEvent(event)
      if (result.inserted) inserted += 1
      else duplicate += 1
    }
    return {
      windowStart: from.toISOString(),
      windowEnd: until.toISOString(),
      candidateCount: candidates.size,
      insertedCount: inserted,
      duplicateCount: duplicate,
      skippedCount: skipped,
      discoveredConversationCount: focusChats.size,
    }
  }

  private async flaggedCandidates(): Promise<{ readonly chatIds: readonly string[]; readonly messages: readonly Candidate[] }> {
    const data = await this.commandData([
      'im', '+flag-list', '--as', 'user', '--page-all', '--page-limit', String(limit(this.config.flagPageLimit, 1000, 1000)),
      '--format', 'json',
    ], 'Feishu flag list')
    complete(data, 'Feishu flag list')
    const flags = records(data.flag_items)
    const messagesById = new Map(records(data.messages).map(message => [optionalText(message.message_id ?? message.messageId, 300), message] as const).filter((entry): entry is readonly [string, Readonly<Record<string, unknown>>] => Boolean(entry[0])))
    const chatIds = new Set<string>()
    const messages: Candidate[] = []
    for (const flag of flags) {
      const itemId = optionalText(flag.item_id ?? flag.itemId, 300)
      const message = isRecord(flag.message) ? flag.message : itemId ? messagesById.get(itemId) : undefined
      const chatId = message && optionalText(message.chat_id ?? message.chatId, 300)
      if (chatId) chatIds.add(chatId)
      if (message) messages.push({ message, reasons: ['flagged-message'] })
    }
    return { chatIds: [...chatIds].sort(), messages }
  }

  private async feedGroupChats(names: readonly string[]): Promise<readonly string[]> {
    if (names.length === 0) return []
    const expected = new Set(names.map(name => name.trim().toLocaleLowerCase()).filter(Boolean))
    const groups = await this.commandData([
      'im', '+feed-group-list', '--as', 'user', '--page-all', '--page-limit', String(limit(this.config.feedPageLimit, 100, 1000)), '--format', 'json',
    ], 'Feishu feed group list')
    complete(groups, 'Feishu feed group list')
    const matched = records(groups.groups).filter(group => {
      const name = optionalText(group.name, 100)
      return name ? expected.has(name.trim().toLocaleLowerCase()) : false
    })
    const chats = new Set<string>()
    for (const group of matched) {
      const groupId = requiredText(group.group_id ?? group.groupId, 'Feishu feed group id', 300)
      const items = await this.commandData([
        'im', '+feed-group-list-item', '--as', 'user', '--feed-group-id', groupId,
        '--page-all', '--page-limit', String(limit(this.config.feedPageLimit, 100, 1000)), '--format', 'json',
      ], `Feishu feed group ${groupId}`)
      complete(items, `Feishu feed group ${groupId}`)
      for (const item of records(items.items)) {
        const chatId = optionalText(item.feed_id ?? item.feedId, 300)
        const type = optionalText(item.feed_type ?? item.feedType, 30)
        if (chatId?.startsWith('oc_') && (!type || type.toLowerCase() === 'chat')) chats.add(chatId)
      }
    }
    return [...chats].sort()
  }

  private async searchMessages(kind: 'sender' | 'chat' | 'direct' | 'mention', ids: readonly string[], from: Date, until: Date): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if ((kind === 'sender' || kind === 'chat') && ids.length === 0) return []
    const messages: Readonly<Record<string, unknown>>[] = []
    const batches = kind === 'sender' || kind === 'chat' ? Math.ceil(ids.length / 20) : 1
    for (let batch = 0; batch < batches; batch += 1) {
      const values = ids.slice(batch * 20, batch * 20 + 20)
      const filter = kind === 'sender'
        ? ['--sender', values.join(','), '--sender-type', 'user']
        : kind === 'chat'
          ? ['--chat-id', values.join(','), '--sender-type', 'user']
          : kind === 'direct'
            ? ['--chat-type', 'p2p', '--sender-type', 'user']
            : ['--is-at-me', '--sender-type', 'user']
      const data = await this.commandData([
        'im', '+messages-search', '--as', 'user', '--query', '', ...filter,
        '--start', isoWithOffset(from), '--end', isoWithOffset(until), '--page-size', '50',
        '--page-all', '--page-limit', String(limit(this.config.searchPageLimit, 10, 40)), '--no-reactions', '--format', 'json',
      ], `Feishu focus ${kind} search`)
      complete(data, `Feishu focus ${kind} search`)
      messages.push(...records(data.messages))
    }
    return messages
  }

  private async commandData(args: readonly string[], label: string): Promise<Readonly<Record<string, unknown>>> {
    const envelope = await runJson(this.runner, this.config.executable ?? 'lark-cli', args)
    if (!isRecord(envelope) || envelope.ok !== true) throw new Error(`${label} did not return a success envelope`)
    if (!isRecord(envelope.data)) throw new Error(`${label} did not return an object data envelope`)
    return envelope.data
  }
}

export const name = 'quark-feishu-focus-discovery-effects'
export const inject = ['quarkWorkflows', 'quarkState']
export function apply(ctx: Context, config: FeishuFocusDiscoveryEffectConfig = {}): void {
  const adapter = new FeishuFocusDiscoveryEffectAdapter(config, ctx.quarkState)
  const dispose = ctx.quarkWorkflows.registerEffect(INTAKE_EFFECTS.discoverSignals, { execute: effect => adapter.execute(effect) })
  ctx.effect(() => dispose, 'quark Feishu focus discovery effects')
}

function sourcesOf(value: unknown): FocusDiscoverySources {
  if (!isRecord(value)) throw new Error('focus discovery sources must be an object')
  return {
    ownerOpenId: requiredText(value.ownerOpenId, 'focus discovery ownerOpenId', 300),
    senderIds: stringArray(value.senderIds, 'focus discovery senderIds', 300),
    conversationIds: stringArray(value.conversationIds, 'focus discovery conversationIds', 300),
    includeOwnerParticipation: value.includeOwnerParticipation === true,
    includeFlaggedConversations: value.includeFlaggedConversations === true,
    includeDirectMessages: value.includeDirectMessages === true,
    includeMentionBackfill: value.includeMentionBackfill === true,
    feedGroupNames: stringArray(value.feedGroupNames, 'focus discovery feedGroupNames', 100),
  }
}

function normalizeDiscoveredMessage(message: Readonly<Record<string, unknown>>, reasons: readonly string[]): NormalizedChannelEvent | undefined {
  const messageId = optionalText(message.message_id ?? message.messageId, 300)
  const chatId = optionalText(message.chat_id ?? message.chatId, 300)
  if (!messageId || !chatId || reasons.length === 0) return undefined
  const senderId = messageSenderId(message)
  const occurredAt = optionalTimestamp(message.create_time ?? message.createTime)
  const chatType = optionalText(message.chat_type ?? message.chatType, 30)
  return {
    kind: 'message.received',
    source: { channel: 'feishu', conversationId: chatId, messageId, ...(senderId ? { senderId } : {}) },
    ...(occurredAt ? { occurredAt } : {}),
    eventKey: FOCUS_DISCOVERY_EVENT_KEY,
    deduplicationKey: messageId,
    payload: {
      content: message.content,
      messageType: message.msg_type ?? message.message_type ?? message.messageType,
      chatType,
      mentions: message.mentions,
      threadId: message.thread_id ?? message.threadId,
      rootId: message.root_id ?? message.rootId,
      chatName: message.chat_name ?? message.chatName,
      discoveryReasons: reasons,
    },
    raw: { message, discovery: { reasons } },
  }
}

function messageSenderId(message: Readonly<Record<string, unknown>>): string | undefined {
  if (isRecord(message.sender)) return optionalText(message.sender.id ?? message.sender.open_id ?? message.sender.openId, 300)
  return optionalText(message.sender_id ?? message.senderId, 300)
}
function mergeCandidate(target: Map<string, { message: Readonly<Record<string, unknown>>; reasons: Set<string> }>, candidate: Candidate): void {
  const id = optionalText(candidate.message.message_id ?? candidate.message.messageId, 300)
  if (!id) return
  const existing = target.get(id)
  if (existing) { candidate.reasons.forEach(reason => existing.reasons.add(reason)); return }
  target.set(id, { message: candidate.message, reasons: new Set(candidate.reasons) })
}
function addReason(target: Map<string, Set<string>>, id: string, reason: string): void {
  const current = target.get(id) ?? new Set<string>()
  current.add(reason)
  target.set(id, current)
}
function complete(data: Readonly<Record<string, unknown>>, label: string): void {
  if (data.has_more === true) throw new Error(`${label} pagination is incomplete`)
}
function records(value: unknown): readonly Readonly<Record<string, unknown>>[] { return Array.isArray(value) ? value.filter(isRecord) : [] }
function requiredText(value: unknown, label: string, max: number): string { const result = optionalText(value, max); if (!result) throw new Error(`${label} is required`); return result }
function optionalText(value: unknown, max: number): string | undefined { return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined }
function stringArray(value: unknown, label: string, max: number): readonly string[] {
  if (!Array.isArray(value) || value.some(item => !optionalText(item, max))) throw new Error(`${label} must be a string array`)
  return [...new Set(value.map(item => String(item).trim()))]
}
function timestamp(value: unknown, label: string): Date { const parsed = new Date(String(value ?? '')); if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a timestamp`); return parsed }
function optionalTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value)
  const parsed = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}
function isoWithOffset(value: Date): string { return value.toISOString().replace('Z', '+00:00') }
function limit(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) throw new Error(`page limit must be an integer from 1 to ${maximum}`)
  return resolved
}
