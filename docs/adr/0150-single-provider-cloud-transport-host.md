# ADR 0150: Single-provider cloud transport host

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

The HTTP and SSH adapters shared a wire contract but could still be composed independently, which would permit two provider graphs to contend for the same device sessions and leases. Transport fallback must change reachability, not ownership.

## Decision

Add one prepared transport host that opens exactly one inactive cloud composition. Its HTTP method delegates to that composition's authenticated handler, while its SSH frame method delegates to the same composition-owned `DeviceSessionServerPortV1`. The host config is exact and requires both transports to remain `prepared-inactive`, `singleProvider=true` and `activationAllowed=false`.

The host opens no TCP/TLS/Unix socket, starts no ssh process, registers no sshd subsystem and owns no scheduler, executor or effect. Future edge adapters must be mounted around this host; they may not construct their own control-plane providers.

## Verification and rollback

A synthetic non-fixture tenant authenticates over the HTTP adapter, registers a device, then obtains an SSH-framed challenge from the same provider graph. Frame causation and scope are preserved. Activation-shaped configuration is rejected before dependencies are opened.

Rollback removes the host, test, ADR and module ownership/dependency update. There is no live transport or new persistent schema.
