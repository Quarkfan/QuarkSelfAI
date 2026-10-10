# ADR 0177: Privacy-bounded Xiaowei insight delivery handoff

## Status

Accepted as inactive migration tooling. It does not enable the native schedule, read messages, invoke an executor or send a digest.

## Context

The compatibility weekly insight digest advances a durable day and window after either a successful delivery or an intentionally empty window. The native migration plan requires this boundary to move before the compatibility scheduler can be retired, but no content-bounded handoff existed. Copying reports, prompts or candidate messages would retain unnecessary business material, while copying only a timestamp without a stable delivery identity could resend an already completed week.

## Decision

The handoff accepts only a complete `lastSentDay` plus `lastWindowEndAt` pair and derives a deterministic delivery fingerprint from the workflow kind and those values. It excludes reports, candidate messages, prompts, model output, transient failure text, chat identifiers and credentials. An incomplete pair fails closed.

Application writes one `xiaowei-insight-digest/delivery-window` feature checkpoint. Replaying identical content is a no-op; a divergent native checkpoint is never overwritten. The audit command is read-only and exposes only counts, a resource-path hash, checkpoint presence and the content digest.

## Consequences

The migration now has a safe, idempotent boundary for this scheduler. Together with the message-intake event and dormant digest-workflow importer, all seven units have synthetic no-effect replay coverage. This still does not prove a real frozen-checkpoint cutover, activate the scheduled native workflow or permit setting the deployment replay receipt.

Rollback removes the handoff implementation, audit command and ADR. A checkpoint written during a later explicitly authorized cutover is durable migration state and must not be silently deleted during code rollback.
