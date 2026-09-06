# ADR 0162: Prepared user service definitions

- Status: accepted
- Date: 2026-09-06

## Context

The installed server can be configured and bootstrapped, but service-manager integration must not silently turn an inactive installation into an auto-starting process or run it as root. A portable deployment also needs reviewable launchd and systemd shapes before any host mutation.

## Decision

Add deterministic renderers and templates for a macOS LaunchAgent and a systemd user unit. Both definitions point only to the installed cloud-server entry and installed server configuration, set the explicit cloud-server enable gate, and use caller-supplied absolute Node and log paths. They contain no credential or tenant metadata.

Rendering returns the complete definition, its SHA-256 digest and a receipt fixed to `prepared-inactive`, unregistered, unstarted, single-provider and effects-off. The rollback contract requires stopping before removing only the definition while preserving installation state. The renderer does not write a service-manager directory, call launchctl/systemctl or start a process.

The systemd unit is intentionally a user unit, and the launchd definition is intentionally a LaunchAgent. A later production system service needs a separately reviewed non-root OS identity and filesystem ownership plan.

## Verification and rollback

Tests verify exact installed paths, explicit enable gating, no secret-shaped content, unresolved-placeholder rejection, inactive receipts and systemd shell/path constraints. Architecture validation assigns both templates to the inactive cloud composition without making them distribution files.

Rollback removes the renderers, templates, tests, ADR and catalog asset ownership. Because nothing is registered or started, no host rollback is required.
