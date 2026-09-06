# ADR 0167: Installed unregistered server service preparation

- Status: accepted
- Date: 2026-09-06

## Context

The server distribution can be installed, configured, assigned a first owner and recovered after a hard process failure, but the user-service definitions from ADR 0162 were still rendered only from a checkout. Registering either definition directly would make deployment depend on repository paths and would combine artifact installation, service-manager mutation and process activation in one irreversible step.

## Decision

Include the launchd and systemd user-service templates in the sealed server distribution and declare their exact paths in its content-addressed manifest. A server installation owns a fourth private host namespace, `service`, alongside `config`, `runtime` and `state`.

Add two commands to the bundled, default-disabled admin entry. `prepare-service` accepts a private exact-schema configuration, recovers the installation configuration and singleton owner, renders one platform-specific definition from the sealed template, then writes the definition and a content-addressed receipt exclusively inside the installation's `service` namespace. The receipt binds the installation and configuration identities, platform, definition digest and absolute host-local executable/log paths while fixing registered, started, auto-start and external effects to false. `status` re-renders and verifies the exact definition before reporting `service-prepared-inactive`.

`remove-unregistered-service` first requires an empty runtime namespace, then verifies the owner lineage, exact two-file service layout and regenerated definition digest. It removes only those two unchanged preparation files. Unknown files, links, permission drift, content drift, runtime residue or lineage drift fail closed and preserve evidence.

Neither command writes a LaunchAgents or systemd directory, invokes `launchctl` or `systemctl`, starts a process, opens a listener, applies SSH configuration or changes a consumer, provider, scheduler or writer. Actual registration, start, health confirmation and owner cutover remain separate lifecycle transitions.

## Verification and rollback

Tests cover both platforms, deterministic recovery, no-overwrite, runtime-state blocking, tamper preservation and the expanded distribution/installation layouts. A post-commit rehearsal must build the clean sealed distribution and run the bundled admin entry through install, configure, first-owner, prepare, status, remove and status without creating a runtime file or touching a service-manager directory.

Rollback uses `remove-unregistered-service` while the definition is verified and runtime is empty, then reverts this revision. A prepared definition that drifted is preserved for inspection; no recursive deletion or durable state removal is permitted.
