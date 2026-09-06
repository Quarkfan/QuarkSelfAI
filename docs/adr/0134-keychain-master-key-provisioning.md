# ADR 0134: Keychain master-key provisioning

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Add a provider-neutral master-key provisioner and a macOS lifecycle that idempotently ensures the existing fixed-service generic-password item. It first performs the existing bounded Keychain read. A valid item is retained. When absent, it generates 32 random bytes locally, encodes them as an exact unpadded base64url value and invokes the absolute `/usr/bin/security` binary with `add-generic-password ... -w`, placing `-w` last so the value is supplied only through stdin. The value never appears in argv, stdout, stderr, returned state or errors.

After creation the lifecycle rereads Keychain and compares the exact generated and stored bytes using constant-time comparison. A failed or timed-out create can be accepted only when a concurrent creator left a separately valid item; otherwise verification fails. All generated, encoded, stdin and readback buffers are cleared. The configured-client facade revalidates its complete inactive plan before invoking this explicit lifecycle.

This code is not automatically run and this batch does not create a real Keychain item. It does not weaken login-keychain access control, start the client, register a device, connect to cloud, invoke an executor or enable effects. Installer UX, signed native application ACL policy and Windows/Linux credential providers remain separate work.

## Rollback

Remove the provisioner contract, macOS lifecycle/writer, configured-client delegate, tests and this ADR. The read-only provider and encrypted client remain unchanged. Since no real item is created by repository tests, rollback has no external state step.
