# ADR 0137: unified installed-executor discovery

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

The configured local client exposes one explicit discovery operation for Claude Code, Codex and the bundled DSH fallback. It composes the existing fixed version probes, fixed authentication-readiness probes and repository-locked DSH closure check into the existing `InactiveExecutorDiscoveryV1`; client initialization still performs no discovery.

Claude Code and Codex are reported ready only when both a parseable supported version and a positive authentication classification are present. DSH is not discovered from an arbitrary `PATH` binary: fallback readiness requires the exact bundled five-package closure and local inference configuration. A missing executable, authentication requirement, version drift, partial DSH closure or individual probe failure stays isolated to that executor and fails closed without preventing the remaining bounded reports.

Only version, readiness, protocol, declared capability, fixed constraints and five-minute timestamps enter the report. Raw process output, authentication details, executable paths, workspace paths, runtime roots and inference configuration values are discarded locally. The operation requires an explicit canonical absolute workspace and does not load a capability, select an executor for a task, invoke an Agent, connect to the control plane or enable an effect.

## Rollback

Remove the unified provider and configured-client method, return to separately invoked fixed probes, remove its tests and this ADR, and restore the module dependency entry. Executor reports are short-lived cache records; no task, capability lifecycle or external state was created by this batch.
