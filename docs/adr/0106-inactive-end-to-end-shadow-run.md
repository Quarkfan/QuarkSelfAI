# ADR 0106: Inactive end-to-end shadow run

Status: Accepted (offline test harness)

## Decision

Connect the existing Agent Studio, Blueprint compiler, tenant control-plane and device session/lease references through one in-memory harness. An exact
test release is compiled into a signed no-effect plan, queued for its tenant/user/device, leased to one authenticated device session, and normalized
for every executor in Blueprint policy order.

The device coordinator owns only challenge/session/lease transport. Its bounded acknowledgement is applied to the test control plane, which remains
the sole task lifecycle owner. The harness then stops and returns only a privacy-bounded `leased-unexecuted` receipt: no executor is invoked, no
completion is claimed, no external effect is permitted, and the current runtime owner remains unchanged.

## Consequences

- contract drift between separate Phase 1–4 components is now caught by one end-to-end fixture;
- transport acknowledgement cannot become a second task-state authority;
- Claude Code, Codex and DSH receive the same normalized context digest;
- stale Studio releases and executor-order drift fail closed before a lease exists;
- a real transport, persistent control plane, executor process and shadow-result comparison remain later approval-gated work;
- rollback is a code revert without state or service operations.
