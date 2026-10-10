# Capability platform workflow replay evidence — 2026-10-10

## Scope and outcome

All seven units in `config/native-migration-plan.json` now have a content-addressed prepare/apply contract and idempotent synthetic replay evidence. The machine gate is embedded in `config/capability-platform-completion.json.workflowReplay`; it requires exact unit coverage, privacy-bounded audit output, a concrete apply entrypoint, successful repeated replay and no activation, external read or external write permission.

This is synthetic no-effect evidence, not a production cutover. `deployment.client.existingWorkflowReplayVerified` remains absent/false, so the platform completion audit continues to report the requirement as incomplete until one frozen compatibility checkpoint is imported in the maintenance window.

## Message-intake closure

The final missing unit now maps:

- pending focus messages to provider-neutral durable events with stable source identities;
- pending reaction lookups to a migration-only event key accepted by the native intake consumer;
- pending notification digests to dormant `message-intake.v1` workflow instances with stable notification idempotency keys and delayed effects;
- the compatibility freeze boundary to a content-addressed feature checkpoint written only after events and workflows have been accepted.

The public audit prints only counts, checkpoint timestamps, a hashed resource path and content digest. The in-memory handoff necessarily carries the pending payload needed to preserve behavior, but tests use synthetic data and no payload is written to evidence, logs or configuration.

## Safety and rollback

No compatibility consumer was paused, no native consumer or effect was enabled, no real message/state file was imported, and no external call was made. Identical replay is a no-op; divergent native checkpoints fail closed. A future real cutover must occur inside the existing maintenance window and quiet-hours policy because already-due dormant notification effects become eligible when the single native effect owner is enabled.

Rollback before cutover is a code revert. After a real cutover, native consumers/effects must be stopped first; the frozen content-addressed compatibility checkpoint remains the rollback source and imported durable records must not be deleted ad hoc.
