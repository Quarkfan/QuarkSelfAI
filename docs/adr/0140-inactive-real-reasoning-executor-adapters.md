# ADR 0140: Add inactive real reasoning adapters for Claude Code and Codex

- Status: accepted
- Date: 2026-09-06

## Context

The durable no-effect cycle had only injected test executors. After ADR 0139 made the signed envelope self-contained, the smallest honest real execution slice is a reasoning-only Agent with no capability graph, context references, workspace grants, approvals or effects. This proves that the same signed program can cross either installed executor boundary without prematurely granting computer access.

Bundled DSH is deliberately excluded from this decision. Its locked packages currently prove a library closure, not a standalone executable entrypoint, so reporting a real DSH adapter before an in-process or packaged host contract exists would be false readiness.

## Decision

Add one `NoEffectClientExecutorPortV1` implementation parameterized only by the exact executor id `claude-code` or `codex`. It revalidates the complete envelope and normalized digest, expiry, signed executor allowlist, positive budget and provider-neutral model policy. It rejects all capabilities, graph nodes, context, workspace grants, approvals and effects before process launch.

The production process runner is module-private. Claude Code receives the program on stdin with JSON output, no tools and no session persistence. Codex receives it on stdin in ephemeral, ignored-user-config, read-only mode. Neither prompt nor model output appears in argv, errors or the privacy-bounded task result. Timeout is the minimum of signed duration, signed deadline and 120 seconds; stdout is bounded and stderr is discarded.

Final text is saved only in a client-local, private, content-addressed store. The cloud-visible result contains a fixed summary code and artifact digest, never the content. Existing artifacts are rehashed before reuse and unsafe permissions, symlinks or digest drift fail closed.

The adapter is not added to configured-client construction or product composition. Invocation remains an explicit caller decision through the existing durable no-effect cycle.

## Verification and rollback

Injected-runner tests verify fixed Claude/Codex argv, stdin-only program delivery, executor identity, digest, expiry and scope gates, JSON/JSONL parsing, local-only result content, idempotent storage and tamper detection. Full repository and architecture checks are required. No test invokes a real model process.

Rollback removes the adapter, tests and this ADR, restores the existing module ownership entry and truth-source notes. Only temporary test artifacts exist; there is no live state, daemon, network connection, owner switch or external effect to unwind.
