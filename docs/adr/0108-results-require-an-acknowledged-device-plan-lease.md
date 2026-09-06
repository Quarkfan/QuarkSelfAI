# ADR 0108: Results require an acknowledged device/plan lease

Status: Accepted (inactive control plane)

## Decision

A test result is accepted only for the exact tenant/user/task/device/plan tuple whose lease has already been acknowledged by the control plane. A
queued task cannot report completion. The first privacy-bounded result is immutable; identical retries return it and conflicting evidence fails.

Artifact references must be SHA-256 digests and completion time must be valid. This contract carries no raw output, lease token, local path or secret.

## Consequences

- a user-scoped result cannot be replayed against another device or plan;
- transport acknowledgement precedes the sole control-plane state transition;
- result retry is idempotent without allowing evidence replacement;
- production device authentication, network receipt and durable storage remain future approval-gated work;
- rollback is a code revert without state migration.
