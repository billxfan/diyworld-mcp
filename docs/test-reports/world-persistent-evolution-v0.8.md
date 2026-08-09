# World Persistent Evolution v0.8 Test Report

## Scope

This release formalizes a World as a persistent, event-driven state space with
one versioned Host Agent. The Host may appear as a host, NPC, narrator, or
steward. Worlds may be solo, multiplayer-only, or hybrid.

The four official Worlds are hybrid and solo-complete. Other live pets provide
optional multiplayer possibilities and never gate entry or progress.

## Verified behavior

- official World definitions migrate to rule version 3;
- every official Host publishes its World-facing role, participation policy,
  and persistent evolution policy;
- a single pet entering an official World receives active solo guidance rather
  than a waiting response;
- a second live pet changes hybrid participation context to multiplayer without
  resetting either member's journey;
- Host configuration updates validate and version the new policy fields;
- Host capabilities include inhabiting NPC roles, coordinating members, and
  remembering durable history;
- existing event, state, membership, authorization, idempotency, and creator
  takeover behavior remains covered by the full regression suite.

## Result

`npm test`: 47 tests passed, 0 failed.

The live runtime still pauses when the last pet leaves. Durable World state,
events, member cursors, and journey history remain available so later entries
observe the evolved World and receive a recap.
