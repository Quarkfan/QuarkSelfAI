# ADR 0100: Platform facilities are not installable artifacts

Status: Accepted (descriptive catalog only)

## Decision

Modules merged into platform core are represented as versioned Platform Facilities, not as installable Capability Artifacts. The initial facilities are
the shared Capability contract/SDK surface, the local client runtime, and the durable hybrid orchestration runtime. Every `core-bound` module Offer
belongs to exactly one facility.

Facilities cannot be installed, selected directly by a Blueprint, or replaced by a private pack. Product capabilities consume their stable ports;
the deployment composition continues to own the implementation.

## Consequences

- all migrated modules remain machine-visible without exposing internal modules as user-facing capabilities;
- Agent Studio can distinguish built-in prerequisites from installable artifacts;
- the core remains independent from any private pack;
- this catalog changes no owner, provider, consumer, scheduler or effect;
- rollback is a code revert with no state migration.
