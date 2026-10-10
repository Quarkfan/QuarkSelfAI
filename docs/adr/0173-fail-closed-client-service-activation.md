# ADR 0173: Fail-closed client service activation

## Status

Accepted as implemented but inactive. This decision adds a reversible activation transaction and a macOS launchd adapter; it does not register or start the current client, enroll a device, enable a capability, or permit external writes.

## Context

ADR 0172 persisted a sealed user-service definition but intentionally stopped before the service-manager boundary. Copying that definition to launchd and treating process existence as readiness would leave crash recovery, duplicate ownership and rollback undefined. It would also make a stale process or stale health file look active.

## Decision

The client process publishes one private, lineage-bound health receipt only after its configured no-effect worker has started. The receipt contains no path, credential, context or output; it binds installation, version and process PID and fixes external writes off. Normal shutdown removes only the receipt owned by the same PID.

Activation is an explicit, admin-gated transaction. It persists an intent, installs the already verified definition, registers and starts the fixed launchd user label, then waits for service-manager PID and process-health PID to agree before atomically committing an active receipt. Failure stops and unregisters before removing health and the digest-verified definition. An interrupted transaction can reconcile to exactly one active owner or reverse to the prepared state. Deactivation applies the same operations in reverse order and preserves installation and client state.

The bundled installer exposes activation, reconciliation, status and deactivation commands, but all mutating activation commands require `QUARK_CLIENT_ADMIN_ENABLE=1`. The shipped installation and current deployment remain inactive.

## Consequences

The platform now has an auditable install-to-daemon activation seam that does not infer readiness from a PID alone. A real activation still requires a durable client installation, device credentials and enrollment, a verified workspace, the matching control-plane signing key and an explicit single-owner cutover. Linux systemd activation remains unimplemented.

Rollback reverts this module and adapter after deactivating any service created by the transaction. Drifted intents, receipts, health or manager definitions are retained and fail closed rather than being deleted.
