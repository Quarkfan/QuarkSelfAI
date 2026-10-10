# ADR 0184: Two-stage approval for BlackLake engineering requests

## Status

Accepted for the active compatibility workflow. It does not add a consumer, provider or writer.

## Context

A single research approval previously allowed a Codex investigation to start and then delivered its conclusion. That contract could not distinguish permission to inspect and propose from permission to change code, configuration or data. It also sent generic progress messages and gave the owner no structured place to add context that the focus-intake reader had missed.

## Decision

An explicit mention or direct message that semantic intake classifies as a clear BlackLake engineering request (`researchDecision=start`, `researchChannel=codex`) enters a durable two-stage workflow.

Before the first approval, the existing single focus-intake consumer reads the replied-to message, bounded conversation context and available assistant knowledge. The approval card shows the bounded evidence and includes optional owner input. That input is analysis context only and cannot grant effects.

The first exact approval creates one visible Codex thread rooted at `/Users/edy/BlackLakeWork` with a read-only sandbox. It may inspect evidence and produce an implementation, validation and rollback plan, but it cannot modify code, configuration or data. Intermediate progress is silent. The bounded plan is hashed and attached to a second approval. Only an exact source, approval and digest match can resume the same thread with the approved plan embedded in the prompt.

The second approval does not supersede existing exact gates for production, release, deployment, DDL, business-data writes, external communication or credential and permission changes. An interrupted `executing` record is restored to `approved` on host restart so the same durable authorization can retry without inventing a new one.

## Consequences

Analysis permission and execution permission are now separate and auditable. The workflow preserves one Feishu consumer, one Codex session lineage and one durable state owner. Non-engineering research and Xiaowei retain their existing paths.

Rollback removes the engineering-specific branch and leaves the additive state records unread. No database migration, consumer switch or external write is required.
