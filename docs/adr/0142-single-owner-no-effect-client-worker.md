# ADR 0142: Add a single-owner no-effect client worker without service activation

- Status: accepted
- Date: 2026-09-06

## Context

The configured client can now execute one signed reasoning action, but only when an embedding caller invokes the facade method. A distributable client needs one owner for periodic executor discovery and device execution cycles. Reusing the existing assistant daemon or adding independent timers per adapter would couple the new client to the compatibility runtime and could create overlapping polls or duplicate execution owners.

## Decision

Add a client-owned worker around the narrow configured-client port. Creation accepts only an explicit closed configuration with `enabled=true`, a canonical local workspace, bounded cycle and discovery intervals, and `externalWritesEnabled=false`; creation itself is inert. `start()` begins one immediate pass, refreshes executor evidence only when due, and then invokes the signed reasoning cycle. The next pass is scheduled only after the current pass settles, so callbacks cannot overlap execution.

Failures become one bounded `client-cycle-failed` state without retaining exception text, credentials, paths, prompts or results. A degraded worker remains eligible for the same bounded retry cadence and returns to running after a successful pass. `stop()` cancels the future timer and waits for the exact in-flight pass; it never creates a replacement owner while shutting down.

This worker is an inactive platform-core facility. It is not a command-line entrypoint, installer activation, launchd/systemd service or current product composition mount. It has no capability loading, workspace mutation, computer-control or external-effect port.

## Verification and rollback

Deterministic tests prove construction is inert, recurring callbacks serialize, executor discovery follows its own interval, failure details are redacted, degraded state is retryable, and stop waits for the in-flight pass without scheduling another. Architecture and exactly-once migration audits must include the worker as local-client platform core.

Rollback removes the worker, tests, catalog/migration entries and this ADR. No schema, persistent state, service registration, runtime owner or external effect needs reversal.
