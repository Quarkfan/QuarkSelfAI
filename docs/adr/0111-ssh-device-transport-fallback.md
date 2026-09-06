# ADR 0111: SSH subsystem fallback for device transport

Status: Accepted (contract only; configured inactive)

## Context

A public HTTPS/WebSocket endpoint may be unreachable from some client networks, including deployments that cannot expose the intended domain. The device
protocol therefore needs a second transport without creating a second scheduler, executor, task owner or write path. SSH is a transport option, not a
substitute for deployment, regulatory or security obligations.

## Decision

Keep direct TLS as the primary client-initiated route and support a client-initiated SSH subsystem named `quark-device-v1` as a fallback. Both carry the
same versioned device-sync messages, signed execution plans, device session identity, task lease, checkpoint and redacted result contracts. Transport
selection cannot change executor selection, action identity, approval grants, workspace scope, effect policy or idempotency.

The client must pin the SSH host-key fingerprint and resolve the gateway, remote identity and private key only through opaque local references. Private
keys remain in the client's secret store. The SSH account exposes only the fixed subsystem: remote shell, arbitrary command execution, TCP forwarding
and agent forwarding are forbidden. A new transport may acquire ownership only after the previous transport releases or loses its device-session lease;
there is never a direct and SSH consumer active for the same device session.

## Recovery and rollout

The current implementation validates and freezes policy and produces an `inactive-plan`; it has no SSH process runner, socket, credential resolver,
listener, server subsystem or runtime mount. Activation requires a separately approved gateway endpoint, real pinned host key, local credential setup,
fixed client adapter, synthetic test tenant, disconnect/resume evidence and a rollback that stops SSH before re-enabling direct ownership. Removing the
policy and contract files is sufficient to roll back this contract-only batch.
