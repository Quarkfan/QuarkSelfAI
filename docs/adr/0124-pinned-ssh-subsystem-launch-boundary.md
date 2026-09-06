# ADR 0124: pinned SSH subsystem launch boundary

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Resolve the SSH gateway, remote user, identity file and pinned known-hosts file only from the exact opaque references in the inactive transport policy. The resulting local-only launch specification uses `ssh` with `shell=false`, the fixed `quark-device-v1` subsystem, strict host-key checking, an isolated config, batch and identities-only modes, and explicit disabling of TTY, agent forwarding, all forwarding and local commands.

Hosts, users, ports and absolute local file paths are validated before building arguments. No arbitrary ssh option, ProxyCommand, remote command or subsystem value can enter from a Blueprint or cloud message. Launch specs contain local paths and therefore may never enter cloud projection or audit payloads.

The current adapter prepares the fixed launch and performs only a local `ssh -V` readiness probe. It does not start SSH, connect to a gateway, resolve actual credentials, acquire a device lease or mount a runtime owner.

## Rollback

Remove the builder/probe, tests, catalog entry and this ADR. No process, connection, credential or live state exists to restore.
