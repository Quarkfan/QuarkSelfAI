# ADR 0163: First-owner receipt forward repair

- Status: accepted
- Date: 2026-09-06

## Context

The first-owner database transaction and receipt creation cannot be one filesystem/SQLite transaction. A crash after database commit but before receipt creation leaves valid durable identity state that must neither be deleted nor blindly bootstrapped again.

## Decision

After first-owner creation, checkpoint the unused database and place it in SQLite DELETE journal mode before writing its receipt. This keeps inactive inspection from creating persistent WAL sidecars; normal server startup may re-enable WAL through the installed migration.

Add an explicit receipt-repair operation for the sole interrupted shape: runtime empty and state containing exactly `control.sqlite3`. The caller supplies only the expected tenant and user identifiers, not a password or replacement metadata. Repair verifies the installation/configuration lineage, private single-link database, SQLite integrity, one active tenant/user/account, the fixed owner role, equal persisted creation timestamps and zero sessions. Only an exact identity match may recreate the standard inactive receipt.

Expose repair through the existing default-disabled server admin entry as `repair-owner-receipt`. It cannot change credentials, tenant/user rows, roles, sessions or activation flags.

## Verification and rollback

Tests delete a valid synthetic receipt, prove a mismatched expected identity creates no file, then repair the exact receipt and pass normal recovery. Existing tests also verify receipt identity drift fails closed.

Rollback removes the repair command and implementation but preserves every database. An interrupted installation can be repaired with the newer binary before rollback; it must never be made "clean" by deleting state.
