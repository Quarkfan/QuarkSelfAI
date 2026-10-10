# Capability cloud installation evidence — 2026-10-10

## Scope

This batch used exact source revision `aecafd2708e83d2f908797e019e8800df355ef76` to build server version `0.2.0`. The sealed distribution contains 14 files and has digest `sha256:fed86beabf5af1d77125433902dd774458c951509f89b8725a50c3ef639c67d6`.

The distribution was byte-verified into a new private local installation and configured for a loopback-only TLS endpoint. The resulting installation identity is `server-installation.50dccd8eda81e61e4233c8393c1f27f9`. The status command revalidated the sealed distribution, configuration lineage, TLS key/certificate pair, pinned Ed25519 public verification key, private permissions, empty runtime namespace and empty tenant-state namespace.

## Current state

- `configured-inactive`
- no tenant or owner account was created;
- no service definition was prepared or copied to a service-manager directory;
- no service was registered or started;
- no TLS or SSH listener was opened;
- no SSH gateway was applied;
- no client was installed or enrolled;
- external effects remain disabled;
- the existing QuarkSelfAI consumer/provider/writer was not changed or restarted.

The first configuration attempt correctly failed closed because the generated TLS source files were not owner-only. After changing only those generated files to mode `0600`, the same operation succeeded. No partial configuration survived the failed attempt.

## Credential boundary

The host approval layer rejected writing the random first-owner credential and plan-signing private key to macOS Keychain without a new explicit approval for those exact credential mutations. No workaround was used. The transient plan-signing private key was deleted after rejection; it was never printed, committed, placed in an argument, or used to create tenant state. The configured installation therefore cannot proceed to owner bootstrap or service activation until a new signing key is generated, stored in the approved local secret store, and the unused configuration is safely reprovisioned with its public key.

## Recovery and rollback

Because the state namespace remains empty, the installation can still use the verified unused-configuration and unused-installation rollback paths. Once a first owner is created, tenant state becomes forward-repair-only and must never be deleted by program rollback. Service activation, when permitted, must use ADR 0171 and commit only after launchd plus pinned TLS health readback.
