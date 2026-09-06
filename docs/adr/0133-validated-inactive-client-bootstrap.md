# ADR 0133: validated inactive client bootstrap

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Introduce one local-only bootstrap document and compiler that assemble the existing client owner from a canonical private state directory, fixed Keychain account, device identity, secret reference and control-plane endpoint. Derived database, artifact, lease and encrypted-secret paths cannot be independently overridden. The migration remains a caller-supplied regular file from the installed runtime.

Compilation validates a closed document, exact identifiers, HTTPS/loopback endpoint policy, an existing canonical non-symlink state directory with no group/other permission bits, and a regular non-symlink migration. Initialization repeats the full plan and path validation before reading Keychain because a TypeScript value is not a runtime trust boundary. It then wires the existing macOS Keychain reader, encrypted local client, public enrollment HTTP transport and device-session HTTP transport behind one close boundary.

Initialization creates or recovers local encrypted identity state but does not connect, poll enrollment, discover executors, load capabilities, invoke an executor or enable effects. Enrollment begin/poll and one no-effect session cycle remain separate explicit methods. Secure Keychain provisioning, installer directory creation, background service lifecycle and non-macOS key providers remain unimplemented.

## Rollback

Remove the configured-client facade, tests, this ADR and its source/dependency catalog entries. Existing client providers and state schemas are unchanged; test state is temporary and no live configuration or service is created.
