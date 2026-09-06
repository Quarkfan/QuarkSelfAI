# ADR 0126: inactive artifact uninstall and recovery

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Complete the local inactive artifact lifecycle without introducing an executable runtime. Uninstall first verifies the exact installed version, then changes the SQLite owner in one immediate transaction: removing a selected version promotes its recorded previous version, removing the final selected version clears selection, and removing a previous version clears only that rollback pointer. Only after commit may the provider remove the receipt and a blob with no remaining SQLite reference. A filesystem cleanup failure is returned as `cleanupPending`; it must not recreate an installed state or be reported as successful byte removal.

Recovery validation treats the database and artifact directory as one staged set. It revalidates every persisted lifecycle snapshot, every selection reference, immutable receipt identity, and every referenced blob digest. Store directories are rechecked on every operation and reject symlinks or unknown entry shapes. The report contains only counts and inactive state, never local paths or content.

Garbage collection runs only after recovery validation. It derives the live receipt and blob sets from SQLite and removes only validly named entries outside those sets. Unknown entries fail closed instead of being guessed or deleted. Install, uninstall, recovery and garbage collection remain local-only, unloaded, unauthorized, stopped and effects-disabled.

## Rollback

Remove the uninstall/recovery/garbage-collection methods, SQLite removal transaction, tests, this ADR and synchronized documentation. The provider is not mounted and tests use temporary directories, so no live data migration or service rollback is required.
