# ADR 0109: Local run checkpoints before persistence

Status: Accepted (inactive in-memory provider)

## Decision

Represent a locally leased no-effect plan as an integrity-protected state machine: `leased → running ↔ paused → completed-pending-sync → synced`.
Acceptance verifies the signed plan and derives the normalized executor context. Exported checkpoints retain the signed declarative plan and a bounded
result, but never retain the lease token, process output, absolute path or credential.

Restore re-verifies checkpoint digest, plan signature, device scope, effect-free boundary and normalized context before admitting state. The provider
demotes an interrupted `running` state to `paused` so recovery cannot execute it twice. It has no executor, filesystem or network adapter; state
transitions in fixtures are contract tests, not claims that work ran.

## Consequences

- disconnect recovery and delayed result sync now have an explicit local state contract;
- tampering, executor drift and effectful plans fail closed;
- actual encrypted persistence, process control and cloud sync remain later approval-gated work;
- rollback is a code revert without data migration.
