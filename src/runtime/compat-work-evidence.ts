import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkJournalEvidenceProvider } from '../work-journal/contract.js'

const dayStart = (day: string): number => new Date(`${day}T00:00:00+08:00`).getTime()
const dayEnd = (day: string): number => new Date(`${day}T23:59:59.999+08:00`).getTime()
const within = (value: unknown, day: string): boolean => {
  const timestamp = new Date(String(value ?? '')).getTime()
  return Number.isFinite(timestamp) && timestamp >= dayStart(day) && timestamp <= dayEnd(day)
}
const compact = (value: unknown, limit: number): string => {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

export class CompatStateWorkEvidenceProvider implements WorkJournalEvidenceProvider {
  constructor(private readonly compatConfigPath: string) {}

  async load(day: string): Promise<Readonly<Record<string, unknown>>> {
    const config = JSON.parse(await readFile(this.compatConfigPath, 'utf8')) as Record<string, unknown>
    if (typeof config.varDir !== 'string') throw new Error('compat config has no varDir for work evidence')
    const state = JSON.parse(await readFile(join(config.varDir, 'state.json'), 'utf8')) as Record<string, unknown>
    const array = (key: string): Record<string, unknown>[] => Array.isArray(state[key]) ? state[key] as Record<string, unknown>[] : []
    return {
      day,
      ownerMessages: array('ownerConversation').filter(item => within(item.receivedAt, day)).map(item => ({ at: item.receivedAt, content: compact(item.content, 800), messageId: item.messageId })),
      matters: array('shadowMatters').filter(item => within(item.updatedAt ?? item.createdAt, day)).slice(-120).map(item => ({ key: item.key, title: compact(item.title, 180), status: item.status, owner: item.actionOwner, nextAction: compact(item.nextAction, 300), deadline: item.deadline, sources: item.sources, taskIds: item.taskIds })),
      decisions: array('shadowDecisions').filter(item => within(item.at, day)).slice(-160).map(item => ({ at: item.at, matterKey: item.matterKey, title: compact(item.title, 180), taskAction: item.taskAction, actionOwner: item.actionOwner, materialChange: item.materialChange, nextAction: compact(item.nextAction, 300) })),
      executions: array('executionHistory').filter(item => within(item.completedAt ?? item.receivedAt, day)).slice(-80).map(item => ({ id: item.id, completedAt: item.completedAt, status: item.status, requestedExecutor: item.requestedExecutor, actualExecutor: item.actualExecutor, fallbackUsed: item.fallbackUsed, sessionId: item.sessionId })),
      feedback: array('shadowFeedback').filter(item => within(item.at, day)).slice(-80),
    }
  }
}
