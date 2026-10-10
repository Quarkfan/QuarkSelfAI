# Capability cloud installation evidence — 2026-10-10

## Scope

The superseding installation used exact source revision `b0791481257f35615d40f63b2a6ca38c9379c99d` to build server version `0.2.0`. The sealed distribution contains 14 files and has digest `sha256:c0f60ccfd30a004b40a5640ce3a70329214302ee41334e309928a703d646632b`.

The distribution was byte-verified into a new private local installation and configured for a loopback-only TLS endpoint. The resulting installation identity is `server-installation.16297eb33340cc5b052ffed14b33d011`. The previous unused configured installation was removed only through its verified unused rollback path. The status command revalidated the sealed distribution, configuration lineage, TLS key/certificate pair, pinned Ed25519 public verification key and private permissions.

## Current state

- `service-active-effects-off`
- exactly one first tenant and owner account were created;
- one fixed launchd user-service definition was prepared and installed;
- launchd readback confirms one registered, running service;
- the loopback TLS listener is active and the certificate-pinned health probe returns `ready-effects-off`;
- no SSH gateway was applied;
- no client was installed or enrolled;
- external effects remain disabled;
- the existing QuarkSelfAI consumer/provider/writer was not changed or restarted.

The first configuration attempt correctly failed closed because the generated TLS source files were not owner-only. After changing only those generated files to mode `0600`, the same operation succeeded. No partial configuration survived the failed attempt.

## Credential boundary

The random first-owner credential is stored under the fixed native macOS Keychain service/account and is passed only through stdin while its hash is created. A first experiment proved that the `security` CLI does not consume `-w` from stdin as required; the resulting empty exact item was deleted. The replacement uses the native Security framework, and metadata-only readback confirmed presence and bounded length without printing the value. The plan-signing private key is an owner-only server configuration file; only its public key and digest are exposed in receipts. Neither secret entered argv, environment, logs, Git or this evidence.

## Recovery and rollback

Tenant state now exists and is forward-repair-only: code rollback must never delete it. Service deactivation remains reversible through the activation transaction, which unregisters launchd and removes only the digest-matched service definition while preserving owner state and configuration. The first activation attempts exposed two recovery defects: KeepAlive bootstrap was followed by a destructive restart, and SQLite WAL/SHM files were rejected during owner recovery. Each failed transaction rolled back registration. The corrected path inspects before kickstart, accepts only validated bounded runtime/SQLite sidecars, waits for launchd process readiness and retries only transient health connection errors. Final activation committed only after launchd and pinned TLS health lineage matched.

## Agent Studio and reversible program upgrade

Revision `317f8fe64edecbf2c709bd4c9b5da5bfb8ff73f8` was sealed as server `0.3.1`, 14 files, artifact digest `sha256:13bc52d63f184cac95dfd54f9dad1ec7b42f6551e382d442d68731358d204a83`. Before mutation, the active service and pinned TLS probe both returned the original installation identity and effects-off state. The only provider was then deactivated, the verified program distribution was upgraded in place, and the same prepared service was reactivated.

The version-2 installation receipt retains `server-installation.16297eb33340cc5b052ffed14b33d011`, records the previous `0.3.0` distribution in the private rollback slot, and leaves configuration and tenant state in place. Post-activation status is `service-active-effects-off`; pinned health is `ready-effects-off`; SSH remains unapplied; the client remains inactive; external effects remain disabled. HTTPS readback of `/` returned the same-origin Agent Studio surface from the single cloud transport host. Automated lifecycle tests additionally perform the reverse program swap and byte-compare tenant SQLite state before and after upgrade/rollback.
