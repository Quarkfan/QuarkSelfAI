# ADR 0144: Content-addressed installable client distribution

- Status: accepted
- Date: 2026-09-06

## Context

The inactive installation and process entry still depended on the repository for executable JavaScript and the SQLite migration. That was useful lifecycle evidence, but it was not an installable client and could not satisfy a different-computer recovery boundary. A service template pointing back into the checkout would preserve the same hidden dependency.

## Decision

Introduce a sealed client distribution rooted at `program/`. The build entry bundles the client and installer JavaScript, includes the DSH stdin host, exact runtime dependency closure, DSH configuration, client migration and an SPDX 2.3 SBOM. A path-free manifest records the client version, exact source revision, fixed entrypoints, every regular file's size and SHA-256 digest, and one aggregate artifact digest. Sealing and verification reject links, public permissions, unknown layouts, missing mandatory files, path traversal and byte drift.

The installer now accepts only that verified distribution. It copies the complete program and its migration into a new private installation, verifies the copied distribution before writing the final receipt, and binds the receipt to source revision and distribution digest. Recovery recomputes the complete inventory. `uninstall-unused` still requires empty durable state, quarantines the installation first and deletes only manifest-declared files and empty directories. The bundled installer exposes only `install`, `status` and `uninstall-unused` with exact absolute paths and bounded private configuration.

Add launchd and systemd renderers whose output points only at the installed program. Rendering returns a digest and explicit `prepared-inactive`, `registered=false`, `started=false` receipt. It writes no system file and calls no service manager. Definitions contain no credentials; a future registration/cutover must remain a separate action.

## Verification and rollback

Tests cover seal/verify, tamper and permission rejection, real inactive install/recovery, independent installed-entry status, durable-state uninstall refusal, atomic unused uninstall, closed installer commands and both service formats. A release pilot must build the full dependency closure from an exact committed revision, install it in a temporary directory, run bundled `status`, and remove the temporary tree.

Rollback stops any future registered service before removing its definition, preserves installations with durable state, and uses `uninstall-unused` only for never-started installations. This batch does not register or start a service, provision a credential, contact a control plane, execute an Agent, activate a capability, change the current consumer/provider/writer or restart QuarkSelfAI.
