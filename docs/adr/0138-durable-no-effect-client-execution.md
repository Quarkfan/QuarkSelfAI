# ADR 0138: durable no-effect client execution

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Add one explicit client execution cycle after executor discovery and signed-plan negotiation. The cycle accepts only plans with no allowed effects, no approval grants and `externalWritesEnabled=false`. It checkpoints `leased` before acknowledgement, checkpoints `accepted` only after the server confirms the exact lease, invokes exactly the previously selected executor through an id-bound `NoEffectClientExecutorPortV1`, checkpoints a privacy-bounded result before submission, and marks the result synced only after the server accepts the exact task, plan and device scope. An ambiguous lost acknowledgement remains fail-closed for later reconciliation and is never treated as permission to execute.

The executor port receives the same normalized `ExecutorAdapterInputV1` for Claude Code, Codex or DSH. The cycle contains no fallback router: a failed invocation is durably paused and a later cycle resumes the same executor and action. A completed result awaiting sync is submitted before polling new work and does not invoke the executor again. This is safe only for the current no-effect test boundary; effectful retries require a separately approved effect/idempotency protocol.

Client initialization, discovery and the existing inactive sync remain separate operations. This batch supplies only an injected executor port and synthetic SQLite integration evidence; it does not add a real Claude Code, Codex or DSH process adapter, background daemon, automatic polling, local file mutation, computer control, production tenant, consumer/provider switch or external write.

## Rollback

Remove the no-effect executor port, execution-cycle method and facade delegates, restore the session-cycle module dependency, remove its integration test and this ADR. The test uses temporary databases and synthetic identity. No live task, process, capability or external state was created.
