# ADR 0118: Keep recoverable client state local and project only bounded metadata

- Status: accepted
- Date: 2026-09-06

## Decision

The installable client owns a separate local SQLite state domain for its device enrollment, workspace mappings, executor reports, installed-inactive capability state and no-effect run checkpoints. The initial provider remains test-tenant-only and runtime-inactive.

The public device identity is stored together with an opaque `secret:` or `keychain:` private-key reference; private key material is never accepted. Workspace handles map to canonical local roots only inside this database. Every resolution rechecks that the authorized canonical root still resolves to the same path, so deleting and replacing it with a symlink cannot widen access. The cloud projection contains only the public device identity, unexpired privacy-bounded executor reports, counts and fixed zero-owner/effect fields. It excludes key references, workspace handles, canonical paths and checkpoint bodies.

Capability state is accepted only as installed, unloaded, unauthorized, stopped and effects-disabled. Run checkpoints reuse the signed-plan/no-effect journal verifier, require monotonic revisions and restore an interrupted running state as paused. This provider does not connect to the cloud, run an executor, install artifacts, resolve secrets, own a consumer/provider/scheduler lease, or mount into product composition.

## Consequences

- Client restart recovery no longer depends on in-memory enrollment or run state.
- Local file access remains first-class without exposing directory inventory or absolute paths to the cloud.
- A future client daemon can compose discovery, device transport and execution around one local state owner rather than creating independent caches.
- Rollback removes the inactive provider, migration and tests; no live client database has been created or migrated.
