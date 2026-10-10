# ADR 0182: Same-origin cloud Agent Studio

## Status

Accepted for the effects-off cloud control plane. Runtime rollout remains an independent lifecycle transaction.

## Decision

The multi-user Agent Studio is served by the same TLS edge and the same `PreparedCloudTransportHostV1` that own the authenticated cloud APIs. It is not mounted into the legacy local assistant console and does not construct a second identity, tenant, device, capability, Agent Studio, dispatch, scheduler or effect provider.

The surface is a fixed first-party HTML/CSS/JavaScript bundle compiled into the sealed server program. Before authentication it exposes no tenant data. A user supplies tenant, user and password to the existing `/v1/auth/login` endpoint over the same origin; the password is cleared after the request and is never persisted by the page. The resulting opaque browser session remains in page memory only. Every later API call carries that opaque session, and tenant/user scope continues to be resolved exclusively by `CloudIdentityPortV1`.

The first supported workflow is deliberately narrow but real: list the authenticated user's drafts, visible inactive capabilities and registered devices; compose a canonical Agent Blueprint; save it with an optimistic revision; publish an immutable `test` release; and dispatch that exact release to one same-user registered device. Dispatch continues through `RegisteredNoEffectAgentOrchestratorV1`, which signs a complete execution envelope and enforces an effects-off plan.

The page cannot add workspace handles, approval grants, automatic triggers or external-effect permissions. Executor selection is restricted to Claude Code, Codex and DSH with `allowMidActionSwitch=false` and session continuity preserved. Capability references are derived only from tenant-visible, evidence-gated catalog records.

## Security and privacy

- The TLS edge emits a restrictive same-origin Content Security Policy, denies framing and referrers, and disables caching.
- No CDN, analytics, remote font, inline script or third-party browser dependency is used.
- The page does not use cookies, `localStorage`, absolute paths or secret references.
- Refreshing or closing the page discards the browser session reference; server-side expiry and logout remain authoritative.
- The cloud receives declarative Blueprint data and bounded identifiers, never local file content, directory listings, credentials or executor commands.

## Rollback

Remove the three fixed asset routes and revert the transport response content-type support. The authenticated `/v1` API, tenant state, releases, devices and queued tests are unaffected. A deployed rollback uses the existing sealed server release rollback transaction; it must not delete tenant state or start a second provider.
