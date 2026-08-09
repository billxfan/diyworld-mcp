# World Concurrency Hardening

## Scope

This change hardens the live World runtime against users responding to the same
older World state at different times.

Implemented:

- observed, received, and current World/member state versions;
- stale-on-arrival and stale-in-queue detection;
- intervening committed World-change context for the Host;
- explicit `apply`, `rebase`, `absorbed`, `conflict`, and `expired`
  dispositions;
- current-version enforcement for creator Host resolution;
- version-qualified atomic state updates;
- deterministic clarification when the platform Host cannot safely rebase an
  old action;
- version-aware MCP contracts and Codex participation instructions;
- bounded `windowed` and `quorum` collective interactions;
- one response per member, deadline readiness, and explicit late-input policy;
- Host-only atomic batch resolution with one public outcome and at most one
  public state change;
- actor-private response receipts and cross-member visibility isolation;
- batch-level stale detection when the World changes during collection.

## Regression scenario

Two users observe World state v1. The first user takes the only key and the Host
commits v2. The second user's v1 action arrives afterward. The runtime records
that it arrived against v2, exposes the intervening outcome to the Host, rejects
an unqualified resolution, and allows the Host to absorb the old action into a
new encounter without duplicating the key or incrementing World state again.

## Collective regression scenarios

- Two members answer the same quorum prompt at different times. The first
  response remains `collecting`; the second makes the batch ready. Individual
  resolution is rejected, and the Host commits both responses, one aggregate
  public outcome, and one World-state version atomically.
- A window reaches its deadline with no responses. It becomes a ready empty
  batch, while a `follow_up` late reply remains an ordinary immediate input.
- An ordinary event changes the World between two collective responses. Direct
  batch application is rejected; an explicit rebase preserves the intervening
  fact and commits the revised collective decision against the latest version.
- With `expire`, a response submitted after resolution is rejected. Actor-only
  responses and receipts are never exposed to another participant.
