# ADR 0127: single-owner inactive client composition

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Introduce one local client application owner that composes the existing enrollment database, content-addressed artifact store, executor discovery coordinator and no-effect device cycle. Opening the application requires absolute caller-owned paths, obtains an exclusive local instance lease, opens the SQLite state, confirms an existing enrollment and completes artifact recovery verification before returning.

The instance lease is an atomically created 0700 directory with a 0600 opaque owner record. A second live process fails closed. A valid lease whose PID is no longer alive is reclaimed with an atomic rename before deletion, so competing recovery attempts cannot both own the original lease. Malformed, unreadable or symlinked lease state is not guessed or removed.

Opening the application does not probe executors, connect to a server, install or load an artifact, start a consumer, or run a scheduler. Discovery and one-shot sync are explicit calls. Discovery writes only privacy-bounded reports to the single SQLite owner. Sync reuses the existing device proof and plan lease contract; it may persist a no-effect checkpoint and acknowledge that lease, but it does not begin or execute the action. Runtime snapshots expose installed counts but keep active capabilities, consumers, providers, schedulers and external writes at zero.

## Rollback

Remove the application root, instance lease, tests, catalog/migration entry and this ADR. It is not mounted by the product or daemon, and integration tests use disposable local directories, so no live owner or state must be transferred.
