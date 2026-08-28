import type { ClaimedWorkflowEffect } from '../storage/types.js'
import { encodeCardCorrelation } from './card-correlation.js'

type JsonObject = Record<string, unknown>

export function buildAssistantCard(effect: ClaimedWorkflowEffect): JsonObject {
  const title = text(effect.payload.title, 'title', 100) ?? titleFromDecision(effect.payload) ?? '需要处理'
  const body = text(effect.payload.body, 'body', 12_000)
    ?? text(effect.payload.prompt, 'prompt', 12_000)
    ?? summaryFromDecision(effect.payload)
    ?? '请查看并处理这条助手消息。'
  const interactive = effect.kind === 'assistant.request-interaction.v1'
  const card: JsonObject = {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'default', summary: { content: plain(`${title} ${body}`).slice(0, 100) } },
    header: {
      title: { tag: 'plain_text', content: title },
      subtitle: { tag: 'plain_text', content: 'QuarkSelfAI · 个人协作助手' },
      template: interactive ? 'yellow' : 'blue',
      icon: { tag: 'standard_icon', token: 'ai-common_colorful' },
      text_tag_list: [{ tag: 'text_tag', text: { tag: 'plain_text', content: interactive ? '待操作' : '通知' }, color: interactive ? 'yellow' : 'blue' }],
    },
    body: {
      direction: 'vertical', padding: '12px 12px 20px 12px', vertical_spacing: '12px',
      elements: [highlight(body, interactive ? 'yellow' : 'blue')],
    },
  }
  const elements = (card.body as { elements: JsonObject[] }).elements
  if (interactive) elements.push(...interaction(effect))
  elements.push({ tag: 'div', text: { tag: 'plain_text', content: '仅回复此卡片；高影响操作仍需精确确认', text_size: 'notation', text_color: 'grey', lines: 1 } })
  return card
}

export function buildTwinOutboundCard(content: string): JsonObject {
  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'default', summary: { content: plain(`常东旭的 AI 分身 ${content}`).slice(0, 100) } },
    header: {
      title: { tag: 'plain_text', content: '常东旭的 AI 分身' },
      subtitle: { tag: 'plain_text', content: '经常东旭确认后发送' },
      template: 'blue',
      icon: { tag: 'standard_icon', token: 'ai-common_colorful' },
      text_tag_list: [{ tag: 'text_tag', text: { tag: 'plain_text', content: 'AI 分身' }, color: 'blue' }],
    },
    body: {
      direction: 'vertical', padding: '12px 12px 20px 12px', vertical_spacing: '12px',
      elements: [highlight(content, 'blue'), {
        tag: 'div',
        text: { tag: 'plain_text', content: '我是常东旭的 AI 分身。本消息已获得他的明确确认；你的回复会由我整理后反馈给他。', text_size: 'notation', text_color: 'grey', lines: 2 },
      }],
    },
  }
}

function highlight(content: string, tone: 'blue' | 'yellow'): JsonObject {
  return {
    tag: 'column_set', flex_mode: 'none',
    columns: [{ tag: 'column', width: 'weighted', weight: 1, background_style: `${tone}-50`, padding: '12px', vertical_spacing: '4px', elements: [{ tag: 'markdown', content }] }],
  }
}

function interaction(effect: ClaimedWorkflowEffect): JsonObject[] {
  const mode = text(effect.payload.mode, 'mode', 40) ?? 'approval'
  const eventType = text(effect.payload.eventType, 'eventType', 120)
  const approvalId = text(effect.payload.approvalId, 'approvalId', 300)
  const payloadKey = text(effect.payload.payloadKey, 'payloadKey', 64)
  const correlation = encodeCardCorrelation({ workflowId: effect.instanceId, effectId: effect.id, ...(eventType ? { eventType } : {}), ...(approvalId ? { approvalId } : {}), ...(payloadKey ? { payloadKey } : {}) })
  if (mode === 'choice') {
    const options = Array.isArray(effect.payload.options) ? effect.payload.options : []
    return [{
      tag: 'select_static', name: 'owner_choice', width: 'fill',
      placeholder: { tag: 'plain_text', content: '请选择' },
      options: options.slice(0, 20).map((option, index) => {
        const item = record(option)
        return {
          text: { tag: 'plain_text', content: text(item?.label, `option ${index} label`, 100) ?? `选项 ${index + 1}` },
          value: JSON.stringify({ correlation, value: item?.value }),
        }
      }),
    }]
  }
  const inputOnly = mode === 'input'
  const formCorrelation = inputOnly
    ? correlation
    : encodeCardCorrelation({ workflowId: effect.instanceId, effectId: effect.id, eventType: 'approval.response', ...(approvalId ? { approvalId } : {}), payloadKey: 'response' })
  const form: JsonObject = {
    tag: 'form', name: formCorrelation, vertical_spacing: '12px',
    elements: [
      {
        tag: 'input', name: 'response', required: inputOnly, input_type: 'multiline_text', rows: 3,
        max_length: 1000, width: 'fill', label: { tag: 'plain_text', content: inputOnly ? '补充信息' : '补充说明（可选）' },
        placeholder: { tag: 'plain_text', content: '直接描述你的决定或补充内容' },
      },
      { tag: 'button', name: formCorrelation, text: { tag: 'plain_text', content: inputOnly ? '提交' : '提交补充说明' }, type: inputOnly ? 'primary_filled' : 'default', width: 'fill', form_action_type: 'submit' },
    ],
  }
  if (inputOnly) return [form]
  return [{
    tag: 'column_set', flex_mode: 'bisect', horizontal_spacing: '8px', columns: [
      { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'button', text: { tag: 'plain_text', content: text(effect.payload.confirmText, 'confirmText', 100) ?? '确认' }, type: 'primary_filled', width: 'fill', behaviors: [{ type: 'callback', value: { correlation, decision: 'approved' } }] }] },
      { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'button', text: { tag: 'plain_text', content: text(effect.payload.declineText, 'declineText', 100) ?? '暂不处理' }, type: 'default', width: 'fill', behaviors: [{ type: 'callback', value: { correlation, decision: 'declined' } }] }] },
    ],
  }, form]
}

function titleFromDecision(payload: Readonly<Record<string, unknown>>): string | undefined { return text(record(payload.decision)?.title, 'decision title', 100) }
function summaryFromDecision(payload: Readonly<Record<string, unknown>>): string | undefined { return text(record(payload.decision)?.summary, 'decision summary', 12_000) }
function record(value: unknown): Readonly<Record<string, unknown>> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined }
function text(value: unknown, label: string, max: number): string | undefined { if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be text`); if (value.length > max) throw new Error(`${label} exceeds ${max} characters`); return value }
function plain(value: string): string { return value.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').replace(/[>*_`#~]/g, '').replace(/\s+/g, ' ').trim() }
