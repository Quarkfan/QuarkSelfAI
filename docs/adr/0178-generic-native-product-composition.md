# ADR 0178: Generic native product composition without private work modules

## Status

Accepted for the inactive native composition. The running compatibility process and private Work Integration Pack remain unchanged and inactive.

## Context

The long-term product manifest and DSH profile still required BlackLake reference routing, Xiaowei research and a work-journal compiler whose prompt embedded a company workspace and business-source rules. That made the nominal product composition non-portable even though the private pack was not activated.

## Decision

The default native manifest and Cordis profile contain only generic product capabilities. Private integration modules may remain catalogued during migration, but architecture validation explicitly excludes modules classified as `private-work-integration` from the requirement that every inactive plugin be mounted by the default product profile. It still validates their package ownership and prevents them from replacing platform core.

The native work journal now uses the existing generic `WorkJournalEvidenceProvider` and `WorkJournalCompiler` ports with a deterministic local-ledger baseline. It performs no executor launch or external read and declares external-source coverage as a gap. A private pack may later supply richer evidence/compiler implementations through those ports, but the core build and startup path does not require them.

The generic inference provider is named by function rather than employer. BlackLake routing and Xiaowei research are removed from the default profile, manifest and required configuration. They are not deleted from the repository or activated elsewhere in this batch.

## Consequences

The inactive native composition can be configured without a company workspace or private Xiaowei identity. Full work-domain isolation is not yet complete because private sources and historical governance remain in mainline during the compatibility transition; `assistant-continuity` therefore continues to report `work-integration-not-yet-isolated`.

Rollback restores the previous native manifest/profile and rich compiler wiring. It does not alter the running compatibility owner, durable data, private pack, credentials, consumers or effects.
