# World Host Experiences v0.7 Test Report

## Scope

The v0.7 regression verifies that the same World and Host contracts can produce
different real-time experiences without adding a nested room layer.

## Covered cases

- all four official Worlds keep stable `world_id` and `world_agent_id` values;
- each official Host returns its own name, entry copy, objective, and choices;
- the ten-minute cafe returns `waiting` for a solo visitor and wakes the waiting
  member's guidance after a second pet enters;
- the garden accepts a scoped persistent-state contribution and rejects an
  impossible whole-World override without applying its proposed state patch;
- the tavern records a World-local role through the normal judgement path;
- the creator workshop uses a World-specific outcome template;
- a user-created non-game World receives the same additive `host_response`
  contract through the general Host fallback;
- live results identify state version changes and include next guidance.

## Result

`npm test` passes 43 of 43 tests.

The runtime remains deterministic and reports `model_backed: false`. Rich
free-form semantic judgement still requires either creator Codex takeover or a
future platform model route.
