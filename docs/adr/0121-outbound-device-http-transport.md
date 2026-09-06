# ADR 0121: outbound device HTTP transport boundary

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

The first concrete device transport is an outbound-only client implementing the existing `DeviceSessionServerPortV1`. Production endpoints must use HTTPS. Plain HTTP is accepted only for an explicit `127.0.0.1` address with an ephemeral port in a bounded test. Userinfo, query strings, fragments, redirects, cookies and browser sessions are not part of the transport.

An unauthenticated `/v1/device-connect/challenge` route accepts only public tenant/user/device scope; it returns a generic bounded rejection when the device is unavailable. Proof, poll, acknowledgement and result reuse the existing single device-session provider. Responses are bounded to 256 KiB and minimally shape-checked before entering the local runtime.

The integration test opens one ephemeral loopback listener, completes challenge/proof/poll/checkpoint-before-ack over real sockets, asserts four requests and closes the listener and both temporary databases. This is transport evidence, not a daemon or production edge activation.

## Rollback

Remove the outbound adapter, reconnect route, test and module mapping. No persistent endpoint, listener, credential, live session or runtime composition exists to restore.
