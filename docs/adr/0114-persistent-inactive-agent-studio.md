# ADR 0114: Agent Studio persists only tenant-scoped test definitions while inactive

- Status: accepted
- Date: 2026-09-06

## Decision

Agent Studio gains a SQLite provider for durable drafts and immutable test releases. Every key begins with `tenantId` and `userId`, every operation passes through the tenant authorization port, drafts use optimistic revisions, and releases are immutable by Blueprint identity and version.

The provider accepts only `test.*` tenants, manual/no-effect Blueprints, opaque device and workspace references, and validated canonical digests. It has no listener, platform-admin bypass, scheduler, dispatcher, executor, runtime mount, production release path, or external effect.

The existing in-memory implementation remains an isolated fixture. Both implementations share the same inactive Blueprint validation policy so persistence does not create a weaker acceptance path.

## Consequences

- Agent drafts and test releases survive process reopen without crossing tenant or user partitions.
- A later cloud API may depend on the port, but mounting that API and selecting a production database remain separately authorized work.
- Rollback is to stop any future consumer first, then remove the inactive provider code and migration before it owns live data. This batch creates only temporary test databases.
