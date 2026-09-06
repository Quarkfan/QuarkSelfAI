# ADR 0107: Shadow effects use a recording sink

Status: Accepted (inactive provider)

## Decision

A shadow effect first passes normal signed-plan verification and exact tenant/user/device/agent/action/effect/scope/expiry approval matching. It is then
written only as a content-addressed `recorded-not-executed` record. The record retains digests and stable identifiers but excludes raw scope and input.

The sink intentionally has no effect callback, adapter or runtime provider dependency. Single-use approvals cannot represent two different attempts,
and identical attempts are idempotent. The inactive end-to-end harness requires this sink and proves a no-effect plan produces zero records.

## Consequences

- Phase 5 comparisons have an auditable destination without creating a second writer;
- an invalid plan, missing grant, scope drift or replay fails closed;
- recording never means an effect succeeded and does not advance task completion;
- actual provider shadow integration and persistence remain later approval-gated work;
- rollback is a code revert with no state migration.
