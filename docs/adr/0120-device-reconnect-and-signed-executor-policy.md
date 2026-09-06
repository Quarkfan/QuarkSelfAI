# ADR 0120: device reconnect and signed executor policy

Status: Accepted for inactive implementation on 2026-09-06.

## Context

The first device-session port issued a challenge only through an authenticated user context. That prevents an already enrolled client from reconnecting after restart without retaining a browser/user session. The execution envelope also omitted the Blueprint executor allowlist and capability requirements, so a client could not prove its executor choice was authorized by the signed plan.

## Decision

Challenge issuance is a pre-authentication operation addressed by public tenant/user/device identifiers. The provider issues it only for a registered device owned by an active user; possession of the enrolled Ed25519 private key remains the sole way to open a session. Rate limiting and enumeration resistance belong to the future edge adapter and do not weaken proof verification.

`ExecutionEnvelopeV1` now signs a non-empty protocol list, non-empty executor allowlist, preferred subset and required executor capabilities. The Blueprint compiler derives them from the immutable executor policy and selected Manifest runtime requirements. This is a pre-activation V1 correction; no deployed platform client consumes the previous shape.

An inactive client cycle uses local enrollment, real device proof, persistent server session state, signed executor negotiation and persistent local checkpoints to accept at most one no-effect lease. It persists the checkpoint before acknowledgement and never begins the run or invokes an executor.

## Rollback

Remove the client cycle and its catalog entry, revert the envelope field/schema/compiler fixtures and restore the user-authenticated challenge signature. No listener, daemon, live session, executor or effect is mounted, so rollback requires no service or data operation.
