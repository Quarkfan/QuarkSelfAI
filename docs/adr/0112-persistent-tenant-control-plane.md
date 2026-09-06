# ADR 0112: Persistent tenant identity boundary before cloud activation

Status: Accepted (persistent provider; runtime inactive)

## Decision

Replace the test-store-only module boundary with a tenant control-plane provider that contains two implementations behind shared contracts: the existing
in-memory `test.*` fixture and an inactive SQLite repository plus authorization-enforcing application service. The persistent repository stores tenant,
user and device identity with composite tenant keys and foreign keys. Identical user and device ids may exist in different tenants without collision.

Every service operation accepts a tenant context and calls an injected authorization port for the exact action and subject. There is no platform-admin
or unscoped listing method. Tenant creation requires the owner role plus `tenant.create`; device registration requires a registered user in the same
tenant, and a `(tenant, device)` identity cannot change owner or public key. Database paths remain deployment configuration and never enter cloud-visible
records.

## Consequences

- this is real durable multi-user identity persistence, but not yet a running cloud control plane;
- SQLite proves schema and application isolation locally; production PostgreSQL row-level security remains a later gate;
- the module remains runtime inactive and is absent from product composition;
- no listener, account provider, credential, device consumer, scheduler or external write is introduced;
- rollback removes the inactive repository, migration and tests; no live data exists to migrate.
