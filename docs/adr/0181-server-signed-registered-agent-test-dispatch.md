# ADR 0181: Server-signed registered Agent test dispatch

Status: accepted, effects-off

Date: 2026-10-10

## Context

The cloud control plane could persist tenant-scoped Agent drafts and test releases, while the local client could verify and execute signed plans. Those halves were not connected for registered tenants: the blueprint compiler admitted only synthetic test tenants, the installed server had no private signing identity, and no application operation could turn an exact test release into a device-scoped queue record. Treating an unsigned draft or a mutable latest revision as executable would break tenant isolation, release lineage and the client trust boundary.

## Decision

Add a registered-tenant orchestration workflow that accepts only an authenticated session, an exact `draftId` plus revision, and a device owned by the same user. It reloads the immutable test release, resolves only capability manifests visible in that tenant, compiles the existing execution envelope with empty external effects and approval grants, signs its canonical digest using a server-local Ed25519 identity, and enqueues it through the existing single device-session provider.

The signer private key is copied into the installed server's private configuration namespace. Configuration validates that it is Ed25519 and exactly matches the public key already pinned by clients. The configuration receipt binds the secret file digest without exposing key bytes; recovery rejects drift, and unused rollback removes only an unchanged configuration with no durable state. The server entry reads the private key only after its path, ownership and permissions pass the existing installed-root checks.

The HTTP operation is `POST /v1/agent-drafts/dispatch-test`. Tenant, user, effects, workspace grants, context and executor command lines are not accepted from the request body. The server derives tenant and user from the opaque login session, keeps workspace/context empty in this first registered path, and produces a 15-minute effects-off plan. Owner and member roles may dispatch their own test releases; auditors may not. No scheduler, recurring trigger, capability activation, external write or current QuarkSelfAI consumer switch is introduced.

## Consequences

- A registered tenant now has one persistent save, immutable test release, signed dispatch and device queue path using the same envelope consumed by Claude Code, Codex and DSH adapters.
- Public/private signing identity mismatch and signing-key drift fail before listener startup or dispatch mutation.
- The path is intentionally insufficient for arbitrary workspace, desktop, network or external-effect execution; those require local grants and durable approval in later gates.
- Rollback stops the effects-off server if active, restores the previous sealed release and configuration, or removes the unused installation. Tenant state is not deleted during service rollback.
