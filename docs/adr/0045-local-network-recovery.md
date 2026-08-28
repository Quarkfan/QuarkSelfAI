# ADR 0045: Local network recovery is an inactive, fail-closed adapter

Status: prepared, inactive

## Context

The local assistant can lose Codex, Claude, Feishu, and Dida connectivity because of a remote provider failure, DNS/routing failure, Clash Verge TUN failure, or Wi-Fi failure. Treating every executor error as a network fault would create disruptive network switching and would mis-handle authentication, quota, schema, model, and permission errors.

## Decision

- A network recovery candidate requires at least two attempts of the same durable action and a connection-class diagnostic. Authentication, authorization, quota/rate-limit, schema, model, and permission failures are excluded.
- Diagnosis probes the current path and an explicit no-proxy Google 204 path separately, plus Codex and Feishu endpoints. Google is evidence, not the sole success criterion.
- Recovery order is Clash disable, remembered `Calvin-TProxy_5G`, remembered `blacklake`, then the reviewed blacklake static-route helper. Each stage is allowlisted and followed by endpoint probes.
- A 30-minute single-flight bucket prevents concurrent failed actions from repeatedly changing network state.
- The feature is an optional local adapter. It does not change DSH/Cordis kernel boundaries and is not mounted in either runtime while incomplete.
- Read-only diagnosis and mutations use separate configuration. Runtime mounting must keep diagnosis separate from the mutation authorization and require an absolute reviewed helper path.
- `deploy/network/magicnet-safe.sh` is the reviewed replacement for the supplied script. It only runs as root, verifies exact SSID and source subnet, is idempotent, refuses to overwrite unrelated manual configuration, and rolls back partial activation.

## Activation gate

The adapter remains `implementation=partial,runtime=inactive` until all of the following are complete:

1. Install a root-owned, non-user-writable helper with fixed subcommands for Clash stop/restore and the two allowlisted SSIDs.
2. Configure only that exact helper through a narrow privileged authorization rule; do not authorize arbitrary `networksetup`, shell, or Downloads paths.
3. Add durable failure notification delivery and exact original-state restoration after an exhausted recovery.
4. Run a controlled maintenance-window drill for each stage and rollback, then explicitly approve activation.

## Rollback

Unset `QUARK_NATIVE_NETWORK_RECOVERY` and `QUARK_NETWORK_MUTATIONS_ENABLED`, restart the same daemon, run the reviewed helper restore operation, and confirm DHCP/DNS, original Wi-Fi, Clash state, Codex, and Feishu connectivity.
