# ADR 0103: Agent Studio draft and test-release boundary

Status: Accepted (inactive test model)

## Decision

Agent Studio drafts are scoped by tenant and author user, carry an immutable validated Blueprint snapshot, and use an integer optimistic revision.
Publishing creates immutable test-release metadata keyed by tenant, user, Blueprint id and semantic version. The same version cannot be republished with
a different digest.

The inactive implementation accepts only `test.*` tenants, `releaseState=test`, manual triggers, and no external-effect permission. It rejects local
absolute paths and secret-shaped configuration. Publishing does not dispatch or schedule the Blueprint.

## Consequences

- multiple users and tenants can use the same draft id without sharing state;
- stale browser tabs cannot silently overwrite a newer draft;
- test-release identity is deterministic and immutable;
- persistence, shared/team editing, HTTP APIs and production release remain separate future gates;
- rollback is a code revert without data migration.
