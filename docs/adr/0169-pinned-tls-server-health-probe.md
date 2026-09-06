# ADR 0169: Pinned TLS server health probe

- Status: accepted for inactive deployment lifecycle
- Date: 2026-09-06

## Context

ADR 0168 provides a bounded readiness response, but service activation still needs a host-side verifier. Accepting plaintext HTTP, an unverified certificate, a process PID or a service-manager success code could acknowledge the wrong listener or a partially opened provider graph.

## Decision

Add a narrow health probe that accepts one literal IP, fixed non-zero port, bounded timeout and the expected PEM certificate bytes. It issues only `GET /v1/health`, requires normal certificate and IP-name verification against that explicit trust anchor, pins TLS to version 1.3, accepts at most 4 KiB of exact JSON and validates the closed effects-off/single-provider response. An installed wrapper first revalidates the complete distribution and host configuration, then rechecks the server/certificate digests before deriving the endpoint. The bundled default-disabled admin exposes this only as explicit `probe-health`.

The public admin receipt contains no host, port, certificate, tenant, path or process identifier. It reports the installation identity and `ready-effects-off` while fixing service registration, SSH application, auto-start and effects to false. Certificate mismatch, hostname mismatch, timeout, oversized body, content-type/status drift, extra or missing response fields and any ownership/effect drift fail closed.

This probe observes one explicitly addressed listener. It does not start or stop a process, invoke a service manager, register a definition, acquire provider ownership, authenticate a user or enable an effect. A future activation coordinator must combine it with the installation lineage and service-manager transaction.

## Verification and rollback

Host tests create two temporary certificates, prove the expected certificate succeeds over TLS 1.3, prove the other certificate fails, reject an ownership-expanded response and validate input bounds. All listeners and certificate files are removed. Rollback removes the probe, test, ADR and module ownership entry; no durable state changes.
