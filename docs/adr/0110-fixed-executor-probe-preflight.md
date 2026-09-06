# ADR 0110: Fixed executor probe preflight before host execution

Status: Accepted (approved executable pilot; runtime inactive)

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

## Pilot 01 evidence

Owner approval bound to revision `13e1be477288e8a5f7e5ed1d9e37b33b8c49c1a9` authorized only the fixed
`--version` probes and a temporary IPv4 loopback round trip. The real readback detected Claude Code `2.1.177` and Codex `0.149.0`; neither was marked
runnable because a version probe cannot establish authentication. No host `dsh` executable was detected even though the repository declares a bundled
DSH runtime. This is an architecture distinction, not evidence that the built-in fallback is absent: a later adapter must inspect the locked bundled
runtime and its provider readiness without inventing a CLI dependency.

The same pilot started one ephemeral `127.0.0.1` listener, transported and verified a signed `test.*` no-effect lease, created an in-memory checkpoint,
and closed the listener. It did not send a prompt, invoke an executor, activate an effect, mount a provider, change composition, persist state or restart
the service. Machine-readable evidence is in `config/capability-platform-executable-pilot-01.json`.

## Pilot 02 evidence

Goal-wide owner authorization allowed the previously frozen Pilot 02 scope to run. Fixed `claude auth status --json` and `codex login status` probes classified both installed CLIs as authentication-ready without retaining their output. Repository manifests proved the bundled DSH closure at `0.1.1-rc.2`; inference configuration was absent from the pilot process, so DSH correctly remained authentication-required.

The one allowed synthetic attempt selected Claude Code. Its fixed public prompt disabled tools, used an empty temporary workspace and had no continuation or effects, but it did not return within the 60-second hard timeout. The process was terminated, raw output was discarded, the temporary workspace was removed, and no fallback executor was tried. Pilot 02 therefore records `completed-bounded-failure`, not executor parity or a successful Agent run.
