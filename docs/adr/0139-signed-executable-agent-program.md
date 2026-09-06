# ADR 0139: Sign the executable Agent program inside the Execution Envelope

- Status: accepted
- Date: 2026-09-06

## Context

`AgentBlueprintV1` already defined an Agent role, goals, capability graph and model policy, but the Phase 3B compiler previously reduced a Blueprint to its identity digest plus pinned artifacts. A client could verify who authored the plan and which artifacts were selected, yet a Claude Code, Codex or DSH adapter could not recover the actual Agent program from the signed envelope. Supplying that program through a second channel would create unsigned execution semantics and executor-specific context drift.

No active client or production plan consumes V1, so correcting the closed contract before activation is safer than preserving a non-executable shape.

## Decision

`ExecutionEnvelopeV1` requires a `program` containing the Blueprint's role, goals, capability graph and model policy. The compiler copies those values before computing the envelope digest; therefore the existing plan signature covers the full declarative Agent program and every executor receives the same immutable input.

The trust-boundary validator requires closed program objects, unique pinned capability and node identities, graph references to pinned artifacts, an acyclic graph, and a preferred model within its allowlist. Configuration is bounded canonical JSON. Absolute host paths, secret-shaped values and direct executable payload fields such as `command`, `script`, `shell`, `argv` and `executable` are rejected. Local data remains accessible only through opaque context references and workspace grants resolved by the client.

`agentId` remains the execution instance identity and is not required to equal the Blueprint ID. The Blueprint reference and digest identify the immutable design.

## Consequences

- Claude Code, Codex and DSH adapters can be implemented against one signed program instead of reconstructing prompts from cloud-side state.
- A signed plan is self-contained for declarative orchestration while remaining unable to deliver arbitrary remote shell code.
- Existing pre-activation V1 fixtures must include `program`; there is no live data migration or compatibility reader.
- This change does not run an executor, install code, connect a daemon, activate a capability, change a consumer/provider, or enable an effect.

## Verification and rollback

Contract tests cover compiler preservation, executor parity, digest drift, unpinned graph references, secret/path rejection, executable-payload rejection and closed schemas. Full build, architecture and repository checks remain mandatory.

Rollback before activation removes `program` from the TypeScript contract and JSON Schema, restores compiler and fixture shapes, and reverts this ADR and truth-source notes. There is no persistent or external state to unwind.
