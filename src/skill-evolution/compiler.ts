export type SkillExecutor = 'claude-code' | 'codex' | 'dsh-native'

export interface ExperienceRecord {
  readonly id: string
  readonly taskFingerprint: string
  readonly observedAt: string
  readonly outcome: 'success' | 'failure' | 'corrected'
  readonly summary: string
  readonly redaction: {
    readonly redacted: boolean
    readonly rawContentStored: boolean
    readonly reasoningStored: boolean
  }
}

export interface KnowledgePattern {
  readonly id: string
  readonly title: string
  readonly statement: string
  readonly remediation: string
  readonly evidenceIds: readonly string[]
  readonly counterEvidenceIds: readonly string[]
  readonly counterEvidenceResolution?: string
  readonly status: 'current' | 'superseded' | 'stale'
  readonly validUntil?: string
}

export interface SkillCandidate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly purpose: string
  readonly patternIds: readonly string[]
  readonly targetExecutors: readonly SkillExecutor[]
  readonly state: 'shadow'
}

export interface SkillEvaluation {
  readonly executor: SkillExecutor
  readonly sampleCount: number
  readonly baselineScore: number
  readonly candidateScore: number
  readonly triggerPrecision: number
  readonly triggerRecall: number
  readonly safetyViolations: number
  readonly approvalViolations: number
}

export interface SkillPromotionPolicy {
  readonly minDistinctTasksPerPattern: number
  readonly minSamplesPerExecutor: number
  readonly minScoreDelta: number
  readonly maxScoreRegression: number
  readonly minTriggerPrecision: number
  readonly minTriggerRecall: number
}

export interface SkillPromotionInput {
  readonly candidate: SkillCandidate
  readonly records: readonly ExperienceRecord[]
  readonly patterns: readonly KnowledgePattern[]
  readonly evaluations: readonly SkillEvaluation[]
  readonly policy: SkillPromotionPolicy
  readonly now: string
}

export interface SkillPromotionDecision {
  readonly outcome: 'reject' | 'keep-shadow' | 'eligible-for-review'
  readonly reasons: readonly string[]
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

function validScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function validPolicy(policy: SkillPromotionPolicy): boolean {
  return Number.isSafeInteger(policy.minDistinctTasksPerPattern)
    && policy.minDistinctTasksPerPattern > 0
    && Number.isSafeInteger(policy.minSamplesPerExecutor)
    && policy.minSamplesPerExecutor > 0
    && Number.isFinite(policy.minScoreDelta)
    && policy.minScoreDelta >= 0
    && Number.isFinite(policy.maxScoreRegression)
    && policy.maxScoreRegression >= 0
    && validScore(policy.minTriggerPrecision)
    && validScore(policy.minTriggerRecall)
}

/**
 * Deterministic safety shell for model-authored skill proposals.
 *
 * The compiler deliberately stops at `eligible-for-review`: promotion and
 * activation belong to the existing approval and repository delivery paths.
 */
export function assessSkillPromotion(input: SkillPromotionInput): SkillPromotionDecision {
  const hardFailures: string[] = []
  const shadowReasons: string[] = []
  const { candidate, policy } = input
  const now = new Date(input.now)

  if (Number.isNaN(now.getTime())) hardFailures.push('invalid evaluation timestamp')
  if (!validPolicy(policy)) hardFailures.push('invalid promotion policy')
  if (candidate.state !== 'shadow') hardFailures.push('candidate must remain shadow before review')
  if (!candidate.name.trim() || !candidate.description.trim() || !candidate.purpose.trim()) hardFailures.push('candidate metadata is incomplete')
  if (candidate.patternIds.length === 0) hardFailures.push('candidate has no motivating patterns')
  if (candidate.targetExecutors.length === 0) hardFailures.push('candidate has no target executors')
  if (unique(candidate.patternIds).length !== candidate.patternIds.length) hardFailures.push('candidate repeats pattern references')
  if (unique(candidate.targetExecutors).length !== candidate.targetExecutors.length) hardFailures.push('candidate repeats target executors')

  const recordById = new Map(input.records.map(record => [record.id, record]))
  if (recordById.size !== input.records.length) hardFailures.push('experience record ids are not unique')
  for (const record of input.records) {
    if (!record.redaction.redacted || record.redaction.rawContentStored || record.redaction.reasoningStored) {
      hardFailures.push(`experience ${record.id} violates privacy boundary`)
    }
    if (!record.taskFingerprint.trim()) hardFailures.push(`experience ${record.id} has no task fingerprint`)
    if (Number.isNaN(new Date(record.observedAt).getTime())) hardFailures.push(`experience ${record.id} has invalid timestamp`)
  }

  const patternById = new Map(input.patterns.map(pattern => [pattern.id, pattern]))
  if (patternById.size !== input.patterns.length) hardFailures.push('knowledge pattern ids are not unique')
  for (const patternId of candidate.patternIds) {
    const pattern = patternById.get(patternId)
    if (!pattern) {
      hardFailures.push(`missing pattern ${patternId}`)
      continue
    }
    if (pattern.status !== 'current') {
      shadowReasons.push(`pattern ${patternId} is ${pattern.status}`)
      continue
    }
    if (pattern.validUntil) {
      const validUntil = new Date(pattern.validUntil)
      if (Number.isNaN(validUntil.getTime())) hardFailures.push(`pattern ${patternId} has invalid expiry`)
      else if (!Number.isNaN(now.getTime()) && validUntil.getTime() <= now.getTime()) shadowReasons.push(`pattern ${patternId} is expired`)
    }
    const evidence = unique(pattern.evidenceIds).map(id => recordById.get(id))
    if (evidence.some(record => record === undefined)) hardFailures.push(`pattern ${patternId} references missing evidence`)
    const distinctTasks = new Set(evidence.flatMap(record => record ? [record.taskFingerprint] : []))
    if (distinctTasks.size < policy.minDistinctTasksPerPattern) {
      shadowReasons.push(`pattern ${patternId} has only ${distinctTasks.size} distinct tasks`)
    }
    if (pattern.counterEvidenceIds.some(id => !recordById.has(id))) hardFailures.push(`pattern ${patternId} references missing counter-evidence`)
    if (pattern.counterEvidenceIds.some(id => pattern.evidenceIds.includes(id))) hardFailures.push(`pattern ${patternId} uses the same record as evidence and counter-evidence`)
    if (pattern.counterEvidenceIds.length > 0 && !pattern.counterEvidenceResolution?.trim()) {
      shadowReasons.push(`pattern ${patternId} has unresolved counter-evidence`)
    }
  }

  const evaluations = new Map<SkillExecutor, SkillEvaluation>()
  for (const evaluation of input.evaluations) {
    if (evaluations.has(evaluation.executor)) hardFailures.push(`duplicate evaluation for ${evaluation.executor}`)
    evaluations.set(evaluation.executor, evaluation)
    if (![evaluation.baselineScore, evaluation.candidateScore, evaluation.triggerPrecision, evaluation.triggerRecall].every(validScore)) {
      hardFailures.push(`evaluation for ${evaluation.executor} contains an invalid score`)
    }
    if (!Number.isSafeInteger(evaluation.sampleCount) || evaluation.sampleCount < 0) hardFailures.push(`evaluation for ${evaluation.executor} has invalid sample count`)
    if (!Number.isSafeInteger(evaluation.safetyViolations) || evaluation.safetyViolations < 0) hardFailures.push(`evaluation for ${evaluation.executor} has invalid safety count`)
    if (!Number.isSafeInteger(evaluation.approvalViolations) || evaluation.approvalViolations < 0) hardFailures.push(`evaluation for ${evaluation.executor} has invalid approval count`)
    if (evaluation.safetyViolations > 0) hardFailures.push(`evaluation for ${evaluation.executor} has safety violations`)
    if (evaluation.approvalViolations > 0) hardFailures.push(`evaluation for ${evaluation.executor} has approval violations`)
    if (evaluation.candidateScore + policy.maxScoreRegression < evaluation.baselineScore) {
      hardFailures.push(`evaluation for ${evaluation.executor} exceeds regression budget`)
    }
  }

  for (const executor of candidate.targetExecutors) {
    const evaluation = evaluations.get(executor)
    if (!evaluation) {
      shadowReasons.push(`missing evaluation for ${executor}`)
      continue
    }
    if (evaluation.sampleCount < policy.minSamplesPerExecutor) shadowReasons.push(`insufficient samples for ${executor}`)
    if (evaluation.candidateScore - evaluation.baselineScore < policy.minScoreDelta) shadowReasons.push(`insufficient score gain for ${executor}`)
    if (evaluation.triggerPrecision < policy.minTriggerPrecision) shadowReasons.push(`trigger precision is too low for ${executor}`)
    if (evaluation.triggerRecall < policy.minTriggerRecall) shadowReasons.push(`trigger recall is too low for ${executor}`)
  }

  if (hardFailures.length > 0) return { outcome: 'reject', reasons: unique(hardFailures) }
  if (shadowReasons.length > 0) return { outcome: 'keep-shadow', reasons: unique(shadowReasons) }
  return { outcome: 'eligible-for-review', reasons: ['evidence, privacy, cross-executor evaluation, and regression gates passed'] }
}
