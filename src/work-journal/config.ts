export interface WorkJournalConfig {
  readonly enabled: boolean
  readonly timeZone: 'Asia/Shanghai'
  readonly closeHour: number
  readonly pollIntervalMs: number
  readonly modelTimeoutMs: number
  readonly workspace: string
  readonly claudeCli: string
  readonly codexCli: string
  readonly larkCli: string
  readonly ownerOpenId: string | undefined
}

function integer(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  return parsed
}

export function loadWorkJournalConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): WorkJournalConfig {
  return {
    enabled: env.WORK_JOURNAL_ENABLED !== 'false',
    timeZone: 'Asia/Shanghai',
    closeHour: integer(env.WORK_JOURNAL_CLOSE_HOUR, 5, 'WORK_JOURNAL_CLOSE_HOUR', 0, 23),
    pollIntervalMs: integer(env.WORK_JOURNAL_POLL_INTERVAL_MS, 3_600_000, 'WORK_JOURNAL_POLL_INTERVAL_MS', 60_000, 86_400_000),
    modelTimeoutMs: integer(env.WORK_JOURNAL_MODEL_TIMEOUT_MS, 900_000, 'WORK_JOURNAL_MODEL_TIMEOUT_MS', 60_000, 3_600_000),
    workspace: cwd,
    claudeCli: env.CLAUDE_CLI?.trim() || 'claude',
    codexCli: env.CODEX_CLI?.trim() || 'codex',
    larkCli: env.WORK_JOURNAL_LARK_CLI?.trim() || env.LARK_CLI?.trim() || 'lark-cli',
    ownerOpenId: env.QUARK_OWNER_OPEN_ID?.trim() || undefined,
  }
}
