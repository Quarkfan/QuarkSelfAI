# ADR 0115: Capability Registry persists verified metadata without lifecycle authority

- Status: accepted
- Date: 2026-09-06

## Decision

The control plane gains a SQLite Capability Registry provider that accepts only `validated-unpublished` Manifest candidates whose identity, canonical digest, signature, SBOM and evidence-policy revision remain intact. Registration produces only `catalogued-inactive` metadata with zero consumers, no provider lease, zero schedulers and external writes disabled.

Every release is keyed by tenant, capability identity and version. `private` releases are visible only to their owner; `tenant` releases are visible within that tenant. Every read and registration invokes the tenant authorization port, and this inactive phase accepts only `test.*` tenants. Public cross-tenant publication is deliberately absent.

Private integration-pack Manifests remain in the private Work Integration Pack and cannot enter the core registry. The provider has no download, installation, loading, authorization, execution, scheduling, effect or network path.

## Consequences

- Verified Capability metadata survives process reopen and can be selected by a future Agent Studio API without conflating catalog presence with installation or activation.
- Tenant sharing is real and testable while public marketplace semantics remain a later, separately approved design.
- Rollback removes this unmounted provider and migration before it owns live data; this batch creates only temporary test databases.
