# ADR 0172: Installed, unregistered client service preparation

## Status

Accepted as an inactive and reversible Phase 2 client lifecycle boundary. It does not authorize service registration, startup, cloud enrollment, capability loading or external writes.

## Context

The client distribution could be sealed and installed, while launchd and systemd definitions were only rendered in memory from repository templates. A user-installed client therefore had no content-addressed, recoverable handoff from installation to a future daemon activation. Copying an arbitrary host definition directly into a service-manager directory would bypass distribution lineage and make rollback ambiguous.

## Decision

The sealed client distribution now contains both service templates under `program/deploy`. Installation creates a private, initially empty `service` namespace. The bundled installer may render exactly one launchd-user or systemd-user definition from the installed template and persist it with a receipt that binds installation, configuration and distribution digests plus the explicit workspace, executable and log paths.

Preparation is fail-closed and remains `service-prepared-inactive`: registered, started, auto-start and external writes are all false. Recovery revalidates the complete installation, re-renders the definition from sealed inputs and compares both bytes and digest. An unused installation cannot be removed while service preparation exists; the caller must first remove the verified unregistered definition. Drifted files are preserved as evidence rather than deleted.

## Consequences

This creates a real install-to-service lifecycle seam without registering or starting a client. A later activation transaction must separately prove device credentials, enrollment, single client ownership and process readiness before it may copy the definition to a service manager. Activation and deactivation must retain the same reverse-order rollback rules and may not infer readiness from process existence alone.

Rollback removes this module and the two distribution templates, after first using the unregistered removal command for any prepared installation. No current runtime, consumer, provider, credential or external system is changed by this decision.
