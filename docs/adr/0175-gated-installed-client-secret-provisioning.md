# ADR 0175: Gated installed-client secret provisioning

## Status

Accepted as an inactive local administration boundary. No real master key or inference credential was read, created, changed or removed by this decision.

## Context

ADR 0174 moved DSH inference credentials out of the parent process environment and into the existing encrypted client store, but an installed distribution had no bounded way to provision that store. Passing a secret through argv, persisting it in service metadata or allowing an arbitrary reference would expose credentials or detach them from the signed installation plan.

## Decision

The bundled installer gains four closed commands: provision the installation master key, provision the DSH inference secret, inspect DSH secret presence and remove the DSH secret. Every mutation requires the exact local `QUARK_CLIENT_ADMIN_ENABLE=1` gate. Master-key provisioning delegates to the existing Keychain provider. Both Keychain read and create use macOS Security.framework through a fixed Swift bridge: only service/account metadata enters argv, generated key bytes enter through stdin, and bounded reads are cleared after use. The `security add-generic-password -w` CLI form is prohibited because host verification proved it does not read the intended stdin value. DSH provisioning accepts at most 8192 bytes from stdin, rejects embedded line or NUL bytes, clears temporary buffers and writes only the `apiKeyRef` already sealed in the recovered bootstrap plan.

Inspection loads only the exact bound reference and returns `configured` or `absent`; any loaded copy is cleared. If the store does not exist, inspection and removal return `absent` without loading Keychain or creating durable state. Removal deletes only that reference. Public receipts contain the installation identity, bounded state and `externalWritesEnabled=false`; they never expose the reference, endpoint, model, secret value or local path. The store and master key are closed and cleared after each operation.

## Consequences

An installed client can be configured without relying on an interactive shell or leaking a credential into argv, launchd/systemd definitions, cloud state or logs. Creating the encrypted store is durable client state, so `uninstall-unused` fails closed even after the DSH reference is removed; recovery or an explicit future state-retirement transaction must handle that state.

This does not authorize a credential mutation, start DSH, activate a service, enroll a device, connect to the cloud or enable effects. A real three-executor pilot still requires separately provisioned local credentials and remains incomplete.

Rollback removes these installer commands and the provisioning module. It must not delete an already provisioned Keychain item or encrypted store implicitly; those are local user state and require the explicit bounded removal/recovery path.
