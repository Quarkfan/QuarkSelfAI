# ADR 0171: Transactional user-service activation

Status: accepted

Date: 2026-10-10

## Context

The cloud server already had a sealed distribution, inactive installation and configuration, first-owner bootstrap, prepared launchd/systemd definitions, a single-instance lease, and a pinned TLS health probe. It still lacked the boundary that turns those verified inputs into one recoverable service-manager transaction. Copying a definition and calling a service manager ad hoc could leave an untracked registered process, treat process existence as readiness, or remove durable tenant state during rollback.

## Decision

Add a user-service activation coordinator with a durable intent written before the first external mutation. The first executable adapter is the macOS user launchd domain. It installs only the exact prepared definition, registers and starts the fixed service identity, requires the manager to report one running service, and then requires the installed certificate-pinned TLS health response with matching installation/configuration lineage. Only after both checks pass is the intent atomically replaced by an active receipt.

Any ordinary failure runs the reverse order: stop and unregister, verify and remove only the manager definition, then remove the intent. If rollback itself is incomplete, the intent is preserved and the reconcile operation either completes the same transaction after manager plus TLS health readback or rolls it back. A second activation is rejected. Deactivation always stops and unregisters before removing the exact definition and never deletes the installation, configuration, tenant database, TLS material, or prepared rollback version.

The active receipt states `singleProvider=true` and `externalEffectsEnabled=false`. Activation does not apply the SSH gateway, enable a capability, dispatch an Agent, switch the existing QuarkSelfAI consumer/provider/writer, or expose a public listener. Linux systemd activation remains a separate implementation requirement even though its definition can already be prepared.

## Consequences

The platform now has a testable forward/rollback transaction for a real macOS cloud-control service rather than only inactive rendering. Actual registration still requires an explicit installed release and host-local lifecycle execution. Completion of this ADR does not prove client activation, public connectivity, multi-user end-to-end use, Work Integration Pack cutover, or retirement of compatibility owners.
