# ADR 0122: Agent Studio write API boundary

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Expose the existing persistent inactive Agent Studio through two authenticated application routes: save a draft with an expected revision and publish an immutable test release from an exact draft revision. Tenant and user scope are derived only from the opaque cloud session; request bodies accept only draft id, Blueprint and expected revision.

The underlying provider remains restricted to `test.*` tenants, manual triggers, no external effects and test releases. These routes do not compile, schedule, dispatch or activate an Agent and do not create a production release path.

## Rollback

Remove the two handler routes, tests and this ADR. Existing inactive draft data remains readable through the provider and requires no migration.
