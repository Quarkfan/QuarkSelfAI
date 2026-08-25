import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type { DurableWorkflowPort } from '../workflow/contracts.js'
import type {} from '../workflow/contracts.js'
import { decodeCardCorrelation, type CardCorrelation } from '../lark/card-correlation.js'
import { INTAKE_EFFECTS } from './types.js'

export interface InteractionEffectConfig { readonly ownerOpenId: string }
export interface InteractionWorkflowRuntime { dispatch: DurableWorkflowPort['dispatch'] }

export class InteractionEffectAdapter {
  constructor(private readonly config: InteractionEffectConfig, private readonly workflows: InteractionWorkflowRuntime) {
    if (!config.ownerOpenId?.trim()) throw new Error('interaction ownerOpenId is required')
  }

  async execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    if (effect.kind !== INTAKE_EFFECTS.applyInteraction) throw new Error(`unsupported interaction effect ${effect.kind}`)
    if (effect.payload.requireExactOwnerAndCorrelation !== true) throw new Error('interaction requires exact owner and correlation')
    const event = object(effect.payload.event, 'interaction event')
    if (event.kind !== 'card.action') throw new Error('interaction source must be a card action')
    const payload = object(event.payload, 'interaction payload')
    if (payload.operatorId !== this.config.ownerOpenId) throw new Error('interaction operator is not the configured owner')
    const parsed = parseAction(payload)
    const type = interactionType(parsed.correlation, parsed.decision)
    const eventPayload: Record<string, unknown> = {}
    if (parsed.correlation.approvalId) eventPayload.approvalId = parsed.correlation.approvalId
    if (parsed.response !== undefined) eventPayload.response = parsed.response
    if (parsed.value !== undefined) {
      if (!parsed.correlation.payloadKey) throw new Error('interaction payloadKey is missing')
      eventPayload[parsed.correlation.payloadKey] = parsed.value
    }
    const deduplicationKey = required(event.deduplicationKey, 'interaction deduplicationKey', 2_000)
    await this.workflows.dispatch(parsed.correlation.workflowId, {
      id: `card-action:${createHash('sha256').update(deduplicationKey).digest('hex').slice(0, 32)}`,
      type,
      occurredAt: timestamp(event.occurredAt),
      payload: eventPayload,
    })
    return { workflowId: parsed.correlation.workflowId, eventType: type, accepted: true }
  }
}

type ParsedAction = { correlation: CardCorrelation; decision?: 'approved' | 'declined'; value?: unknown; response?: string }

function parseAction(payload: Readonly<Record<string, unknown>>): ParsedAction {
  const action = maybeJson(payload.actionValue)
  if (isRecord(action) && 'correlation' in action) {
    const decision = action.decision
    if (decision !== undefined && decision !== 'approved' && decision !== 'declined') throw new Error('interaction decision is invalid')
    return { correlation: decodeCardCorrelation(action.correlation), ...(decision ? { decision } : {}), ...('value' in action ? { value: action.value } : {}) }
  }
  const correlation = decodeCardCorrelation(payload.actionName)
  const form = maybeJson(payload.formValue)
  const response = formResponse(form) ?? optionalText(payload.inputValue, 1_000)
  if (!response) throw new Error('interaction form response is required')
  return { correlation, value: response, response }
}

function interactionType(correlation: CardCorrelation, decision?: 'approved' | 'declined'): string {
  if (decision) {
    if (!correlation.approvalId) throw new Error('approval correlation is missing approvalId')
    return `approval.${decision}`
  }
  if (!correlation.eventType) throw new Error('interaction correlation is missing eventType')
  return correlation.eventType
}

function maybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}
function formResponse(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return optionalText(value.response, 1_000)
}
function timestamp(value: unknown): string {
  if (value === undefined) return new Date().toISOString()
  const result = required(value, 'interaction occurredAt', 100)
  if (Number.isNaN(new Date(result).getTime())) throw new Error('interaction occurredAt must be a timestamp')
  return result
}
function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return required(value, 'interaction response', max)
}
function required(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return value
}
function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export const name = 'quark-intake-interaction-effects'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: InteractionEffectConfig): void {
  const adapter = new InteractionEffectAdapter(config, ctx.quarkWorkflows)
  const dispose = ctx.quarkWorkflows.registerEffect(INTAKE_EFFECTS.applyInteraction, { execute: effect => adapter.execute(effect) })
  ctx.effect(() => dispose, 'quark intake interaction effects')
}
