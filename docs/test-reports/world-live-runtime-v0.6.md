# World Live Runtime v0.6 Test Report

## Scope

The v0.6 regression covers direct World entry, on-demand Host activation,
creator Codex takeover, live input handoff, atomic Host resolution, platform
fallback, live notifications, and the absence of a user-facing room layer.

## Automated coverage

- a new World starts with an idle platform Host runtime;
- the first entry activates it and the last exit returns it to idle;
- active member counts follow live presence rather than historical sessions;
- `world_input_submit` rejects pets that have not entered the World;
- only an owner or administrator in the matching Codex session can take over;
- creator takeover prevents the platform policy engine from auto-resolving;
- an expired creator lease automatically restores the platform executor;
- Codex heartbeats refresh live World sessions and stale sessions expire;
- the Host can read the next pending input with its World-local context;
- an accepted Host result commits outcome and state atomically;
- release restores the platform executor;
- pending and committed World events create real-time wake-up notifications;
- the shared MCP registry exposes World entry, presence, Host runtime, takeover,
  heartbeat, input, resolution, release, and exit tools;
- no `world_room_*` tool or user-facing nested room was introduced.

## Result

`npm test` passes 39 of 39 tests with zero failures.

## Known boundary

The platform Host uses the deterministic `platform_policy_v0` runner. This
report does not claim model-generated scene reasoning; model routing remains a
separate integration behind the tested runtime contract.
