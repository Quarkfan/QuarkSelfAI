# ADR 0185: Resolve bounded matter context before task projection

## Status

Accepted for the active compatibility workflow. Runtime activation requires the normal tested daemon restart; no second consumer,
provider or writer is introduced.

## Context

The focus intake already loads a bounded conversation window and searches Dida for similar tasks. That is insufficient when the same
matter appears in a group, a direct message and a second project conversation. The compatibility workflow also maintained a bounded
`shadowMatters` index, but only after task projection and only during the original seven-day reporting window. It therefore could not
prevent a duplicate before the write, and it stopped learning after the report completed.

Recent read-only evidence showed 254 focus decisions over five days and 48 created tasks. Many entered through attention signals such
as mentions, pinned conversations, owner participation, flags and reactions. Those signals justify reading a message, not asserting an
unfinished owner action. Prompt-only admission is insufficient because the same model can declare its own `intakeDecision`,
`actionRequired` and owner evidence.

## Decision

The existing single focus-intake workflow resolves matter context before invoking the sole Dida projection writer:

1. The bounded matter index remains active after the one-time shadow report. It stores no message body. It keeps opaque matter keys,
   hashed stable references, bounded titles and next actions, status, responsibility, deadlines, task ids and source counts.
2. Before projection, intake compares the target plus bounded conversation context with recent matters. Exact stable-reference matches,
   semantic candidates and a small recent active set are passed to the existing reasoning worker. Chat and sender inventories are not
   exposed in the candidate view.
3. The worker must classify the message as an existing, new, absent or ambiguous matter and supply the unfinished outcome, owner
   responsibility evidence, expected state change and merge/new rationale before creating a task.
4. A deterministic gate rejects a second task when a stable reference already belongs to an active task. It also rejects vague actions
   such as merely watching or learning about an item. Ambiguous matter identity cannot create a task.
5. A newly created projection must bind one concrete `topicAnchor` to both its title and an exact quote in the bounded source
   conversation. One to three exact quotes are required, and any due date additionally requires an exact, time-bearing source quote.
   Generic anchors and facts imported from another conversation or model memory fail closed. Because the compatibility reasoning worker
   still performs the MCP write before returning its structured result, a failed grounding check deletes only that exact newly-created
   task through the existing compensation path and leaves the source message retryable.
6. Projection remains the only Dida writer. Context lookup is read-only and failure is represented as unavailable, never as proof that
   no existing matter exists. Existing Dida searches and write-after-read verification remain mandatory.

This compatibility implementation is an incremental safety repair. The native destination remains the durable event → matter → action
model described in `docs/architecture.md`; compatibility state must not become a second product truth source.

## Privacy and retention

Stable external references are stored only as truncated SHA-256 digests. Candidate context is bounded to eight matters and omits raw
message content, chat ids, sender ids and conversation names. Existing bounded lineage compaction remains in force. Business content is
not uploaded to a new service or written to product-mainline datasets.

## Verification and rollback

Contract tests must prove cross-conversation matching, post-report index continuity, raw-content exclusion, pre-projection context
delivery, exact-reference duplicate rejection, vague-action rejection, invented-topic rejection and due-date evidence rejection. Full
compatibility, architecture and repository checks remain required before activation.

Rollback sets `QUARK_MATTER_CONTEXT_ENABLED=0` and restarts the same compatibility host, or reverts this revision. The additive hashed
fields may remain unread. Rollback does not switch consumers, providers or task writers and does not mutate existing Dida tasks.
