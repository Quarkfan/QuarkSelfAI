# ADR 0110: Fixed executor probe preflight before host execution

Status: Accepted (inactive pure provider)

## Decision

Represent discovery of Claude Code, Codex and DSH as a fixed, immutable allowlist before adding a host process adapter. Each descriptor contains only a
known executable name, `--version`, a bounded timeout, a minimum semantic version and declared protocol/capability support. The pure classifier accepts
an injected bounded observation and emits only availability, semantic version, protocol/capability declarations, generic constraints and timestamps.
Raw output, executable paths, account identifiers and authentication material never enter the public report.

Authentication is an explicit adapter observation, not text inferred from arbitrary command output. Missing auth, malformed output, timeout, non-zero
exit and an unknown auth state fail closed. A second pure preflight requires one report for each supported executor on one test device, then delegates
selection to the shared negotiation contract. Claude Code and Codex remain preferred; DSH is selected only as an eligible fallback. The result is always
`ready-unarmed` or `blocked-unarmed` with listener, execution and external-write flags fixed false.

## Consequences

- the approved host adapter cannot choose arbitrary commands or publish process output;
- executor fallback follows the same protocol/capability requirements as every signed plan;
- real binary probes, login checks, loopback transport and Agent execution remain separate authorization-gated steps;
- this provider has no process runner, socket, persistence, runtime mount or effect callback;
- rollback is a code revert without state or service recovery.
