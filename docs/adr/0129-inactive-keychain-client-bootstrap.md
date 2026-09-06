# ADR 0129: inactive Keychain client bootstrap

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Introduce a provider-neutral `LocalMasterKeyProviderV1` and an inactive encrypted-client bootstrap owner. The owner obtains one 32-byte key, opens the authenticated encrypted device-secret store, clears the returned key buffer, and initializes the local application under its existing single-instance lease. On first use it creates the enrollment exactly once. On restart it requires exact tenant, user, device and secret-reference agreement and proves that the recovered private key derives the persisted public identity before returning a disconnected client.

The first concrete provider is a read-only macOS Keychain adapter for a pre-provisioned generic-password item. Its service name is fixed, its account is validated, it invokes `security find-generic-password` without a shell, and no secret enters process arguments. Output is bounded, decoded only as an exact 32-byte unpadded base64url value and cleared after use. Missing items, other platforms, malformed output, timeouts and command failures return bounded errors without account or output data.

Keychain provisioning is deliberately not implemented through the `security` CLI because that command would place the new secret in process arguments. A future native installer or UI must provision it through an OS credential API. Windows and Linux providers, install packaging, daemon startup, cloud registration, automatic discovery, connection, execution and effects remain absent. The new composition is not mounted into the current product.

## Rollback

Remove the provider port, Keychain reader, encrypted bootstrap owner, tests, catalog entries and this ADR. No real Keychain item, persistent client directory, process owner, network session or effect is created by this batch; tests use injected observations and temporary directories.
