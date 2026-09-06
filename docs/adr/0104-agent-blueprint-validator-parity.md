# ADR 0104: Agent Blueprint validator parity

Status: Accepted (inactive contract hardening)

## Decision

The runtime Blueprint validator enforces the closed public schema and canonical payload digest. It validates identity, release state, goals, pinned
Capability references, graph nodes and edges, DAG structure, triggers, executor preference/fallback separation, device/workspace opaque handles,
permissions, model selection, budget, retry, notifications and retention.

Graph nodes must reference a declared Capability. Deterministic failures remain single-attempt, action/session continuity cannot be relaxed, and a
preferred model must be in the allowed set.

## Consequences

- Agent Studio, the Blueprint compiler and SDK now share one fail-closed entry point;
- stale digests and structurally valid but semantically unsafe graphs are rejected before release or dispatch;
- validation itself does not publish, schedule or execute anything;
- rollback is a code revert without state migration.
