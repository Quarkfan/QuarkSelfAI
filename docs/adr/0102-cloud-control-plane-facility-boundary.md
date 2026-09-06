# ADR 0102: Cloud control-plane facility boundary

Status: Accepted (descriptive correction)

## Context

The first Platform Facility catalog grouped all executable platform services under `local-client`. That incorrectly placed tenant storage, Blueprint and
Offer compilation, and server-side device session/task lease coordination on the client side.

## Decision

Create a distinct `cloud-control-plane` facility and move the five descriptive module Offers there. The local client facility retains the DSH/Cordis
host, workspace and executor routing, inactive installation planning, and device-side negotiation. The durable hybrid facility remains separate.

This is a migration metadata correction only. No source import, deployment composition, process, listener or owner changes.

## Consequences

- Agent Studio and registry work now has the correct dependency direction;
- cloud coordination depends on public contracts and never on a private pack;
- clients do not own tenant-wide release or scheduling state;
- rollback restores the prior descriptive grouping without runtime action.
