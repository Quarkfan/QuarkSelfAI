# ADR 0140: Add inactive real reasoning adapters for Claude Code, Codex and DSH

- Status: accepted
- Date: 2026-09-06

## Context

The durable no-effect cycle had only injected test executors. After ADR 0139 made the signed envelope self-contained, the smallest honest real execution slice is a reasoning-only Agent with no capability graph, context references, workspace grants, approvals or effects. This proves that the same signed program can cross either installed executor boundary without prematurely granting computer access.

The initial library-only DSH closure was insufficient: it had no product headless entrypoint and falsely implied fallback readiness. The executable slice therefore also has to lock the published `@deepseek-ai/dsh` CLI and every required peer needed by its headless plugin tree.

## Decision

Add one `NoEffectClientExecutorPortV1` implementation parameterized by the exact executor id `claude-code`, `codex` or `dsh`. It revalidates the complete envelope and normalized digest, expiry, signed executor allowlist, positive budget and provider-neutral model policy. It rejects all capabilities, graph nodes, context, workspace grants, approvals and effects before process launch.

The production process runner is module-private. Claude Code receives the program on stdin with JSON output, no tools and no session persistence. Codex receives it on stdin in ephemeral, ignored-user-config, read-only mode. DSH receives it through a fixed stdin host which mutates only the child process's in-memory argv before importing the pinned product launcher; the operating-system argv contains only that host path. A product-owned overlay disables every shipped model-facing file, shell, Web, Skill, command, goal, subagent and workflow tool, selects the existing local inference secret contract and disables telemetry. The child environment is allowlisted. Neither prompt nor model output appears in operating-system argv, errors or the privacy-bounded task result. Timeout is the minimum of signed duration, signed deadline and 120 seconds; stdout is bounded and stderr is discarded.

Final text is saved only in a client-local, private, content-addressed store. The cloud-visible result contains a fixed summary code and artifact digest, never the content. Existing artifacts are rehashed before reuse and unsafe permissions, symlinks or digest drift fail closed.

The adapter is not added to configured-client construction or product composition. Invocation remains an explicit caller decision through the existing durable no-effect cycle.

## Verification and rollback

Injected-runner tests verify fixed Claude/Codex/DSH argv, stdin-only program delivery, executor identity, digest, expiry and scope gates, result parsing, local-only result content, idempotent storage, tamper detection, temporary cleanup and no mid-action switch. The explicit pilot additionally records real process evidence: Claude timed out, Codex exited nonzero, and the independently selected DSH action succeeded outside the network sandbox with the same public synthetic signed program. The DSH result body remained local and was deleted with the temporary state; only its digest and bounded receipt were retained. Full repository, architecture and clean-install checks are required.

Rollback removes the adapter, tests and this ADR, restores the existing module ownership entry and truth-source notes. Only temporary test artifacts exist; there is no live state, daemon, network connection, owner switch or external effect to unwind.
