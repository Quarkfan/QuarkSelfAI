const HOUR_MS = 60 * 60_000

export interface ProactiveDialogueDecision {
  readonly decision: 'ask' | 'skip'
  readonly question: string
  readonly reason: string
  readonly answerUse: string
  readonly knowledgeKey: string
  readonly cardTitle: string
  readonly cardTone: 'blue' | 'green' | 'yellow' | 'grey'
  readonly valueScore: number
  readonly revisitAfterHours: number
}

export interface ProactiveQuestion extends Record<string, unknown> {
  id: string; askedAt: string; status: 'asked' | 'answered' | 'expired'; question: string
  reason: string; answerUse: string; knowledgeKey: string; messageId: string | null
  answer?: string; answeredAt?: string; expiredAt?: string
}

export interface ProactiveDialogueState extends Record<string, unknown> {
  version: 1; questions: ProactiveQuestion[]; lastEvaluatedAt: string | null
  nextEvaluateAt: string | null; failure: Record<string, unknown> | null
}

function compact(value: unknown, max = 1000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function validateProactiveDialogueDecision(value: unknown): ProactiveDialogueDecision {
  const record = object(value)
  if (record.decision !== 'ask' && record.decision !== 'skip') throw new Error('主动交流决策无效')
  if (!Number.isInteger(record.valueScore) || Number(record.valueScore) < 0 || Number(record.valueScore) > 100) throw new Error('主动交流价值评分无效')
  if (!Number.isInteger(record.revisitAfterHours) || Number(record.revisitAfterHours) < 12 || Number(record.revisitAfterHours) > 168) throw new Error('主动交流复查时间必须为 12–168 小时')
  if (!['blue', 'green', 'yellow', 'grey'].includes(String(record.cardTone))) throw new Error('主动交流卡片色调无效')
  if (record.decision === 'ask') {
    for (const field of ['question', 'reason', 'answerUse', 'knowledgeKey', 'cardTitle']) if (!compact(record[field])) throw new Error(`主动交流缺少 ${field}`)
    if (compact(record.question).length > 180 || compact(record.cardTitle).length > 24) throw new Error('主动交流问题或标题过长')
    if (Number(record.valueScore) < 75) throw new Error('低价值问题不得主动打扰用户')
    if (/(?:自动|直接|立即)?(?:更新|修改|启用|写入).{0,12}(?:配置|策略|规则)|(?:配置|策略|规则).{0,12}(?:自动|直接)(?:更新|修改|启用|写入)/u.test(compact(record.answerUse))) {
      throw new Error('主动交流不得承诺自动修改配置或策略')
    }
  } else if (['question', 'answerUse', 'knowledgeKey', 'cardTitle'].some(field => compact(record[field]))) throw new Error('跳过主动交流时不得生成问题')
  return record as unknown as ProactiveDialogueDecision
}

export function ensureProactiveDialogueState(root: Record<string, unknown>): ProactiveDialogueState {
  const current = object(root.proactiveConversation)
  if (!Array.isArray(current.questions)) current.questions = []
  current.version = 1
  current.lastEvaluatedAt ??= null; current.nextEvaluateAt ??= null; current.failure ??= null
  root.proactiveConversation = current
  const learning = object(root.collaborationLearning)
  learning.version ??= 1; learning.observations ??= []; learning.ownerSignals ??= []; learning.candidates ??= []; learning.proactiveInsights ??= []
  root.collaborationLearning = learning
  return current as unknown as ProactiveDialogueState
}

export function pendingProactiveQuestion(root: Record<string, unknown>, now: Date, maxAgeMs: number): ProactiveQuestion | null {
  const holder = ensureProactiveDialogueState(root)
  for (const item of holder.questions.filter(entry => entry.status === 'asked')) {
    if (now.getTime() - new Date(item.askedAt).getTime() >= maxAgeMs) { item.status = 'expired'; item.expiredAt = now.toISOString() }
  }
  return holder.questions.find(item => item.status === 'asked') ?? null
}

export function recordProactiveAnswer(root: Record<string, unknown>, answer: unknown,
  meta: { source?: string; messageId?: string | null }, now: Date, maxAgeMs: number): ProactiveQuestion | null {
  const question = pendingProactiveQuestion(root, now, maxAgeMs); const text = compact(answer, 2000)
  if (!question || !text) return null
  question.status = 'answered'; question.answeredAt = now.toISOString(); question.answer = text
  question.answerSource = meta.source ?? 'card'; question.answerMessageId = meta.messageId ?? null
  const learning = object(root.collaborationLearning)
  const insights = Array.isArray(learning.proactiveInsights) ? learning.proactiveInsights as Record<string, unknown>[] : []
  insights.push({ at: now.toISOString(), questionId: question.id, knowledgeKey: question.knowledgeKey, question: question.question, answer: text, status: 'owner-stated' })
  learning.proactiveInsights = insights.slice(-100)
  return question
}

export function buildProactiveDialogueContext(root: Record<string, unknown>, now: Date): Record<string, unknown> {
  const learning = object(root.collaborationLearning); const since = new Date(now.getTime() - 14 * 24 * HOUR_MS)
  const observations = (Array.isArray(learning.observations) ? learning.observations : []).filter(item => new Date(String(object(item).at ?? 0)) >= since).map(object)
  const count = (field: string, value: unknown): number => observations.filter(item => item[field] === value).length
  const holder = ensureProactiveDialogueState(root)
  return { currentTime: now.toISOString(),
    recentConversation: (Array.isArray(root.ownerConversation) ? root.ownerConversation : []).slice(-12).map(item => { const entry = object(item); return { at: entry.receivedAt ?? null, role: entry.role === 'assistant' ? 'assistant' : 'owner', content: compact(entry.content, 600) } }),
    collaborationSignals: { samples: observations.length, possibleNoise: count('difference', 'possible_noise') + count('difference', 'could_batch'), possibleMiss: count('difference', 'possible_miss'), created: count('taskAction', 'created'), updated: count('taskAction', 'updated'), ignored: count('taskAction', 'ignored') },
    recentQuestions: holder.questions.slice(-8).map(item => ({ askedAt: item.askedAt, question: item.question, knowledgeKey: item.knowledgeKey, status: item.status, answer: item.status === 'answered' ? compact(item.answer, 500) : '' })),
    learnedInsights: (Array.isArray(learning.proactiveInsights) ? learning.proactiveInsights : []).slice(-8).map(item => { const insight = object(item); return { at: insight.at, knowledgeKey: insight.knowledgeKey, answer: compact(insight.answer, 500) } }),
  }
}
