# World Runtime MVP Test Report

## Verdict

可交付到共享认证服务的封闭测试层。

The World runtime core and its shared authenticated HTTP/MCP transport pass the
full regression suite with no known Critical or High defects.

## Automated result

- Command: `npm test`
- Result: 24 passed, 0 failed
- Mode: MVP Test

## Core paths covered

- Profile, behavior specification, and member-rule versions evolve
  independently.
- Metadata and behavior edits do not eject present members.
- Member-rule changes require renewed acceptance.
- Every world receives exactly one active logical referee Agent.
- Authenticated user, acting pet, world, and World Agent IDs remain distinct.
- Automatic worlds atomically record input, judgement, outcome, world state,
  and member state.
- Stable idempotency keys prevent duplicate state changes after retries.
- Managed worlds accept member inputs while the creator is offline and expose
  them for later review.
- Non-managers cannot resolve pending intents.
- Database triggers reject state changes without an active World Agent.
- World sessions separate current Codex context from durable membership.
- Each owner controls delegation only for their own pet.
- Paused pets cannot act.
- Timestamp and accepted-event triggers produce durable world events.
- Event pagination does not skip unread events.
- Existing venue databases migrate additively without losing records.
- The Codex MCP surface exposes the lifecycle and runtime tools.
- Shared authenticated clients can discover, create, publish, join, observe,
  act in, and resolve direct or managed worlds.
- Approval, unlisted shares, hidden invitations, and rule re-acceptance retain
  the same behavior after moving behind the shared service.

## Remaining boundary

The kernel is now behind the shared authenticated server and exposed through
the primary Codex MCP. Public rollout still requires a deployed migration
rehearsal, real multi-account acceptance testing, delivery/latency monitoring,
backup-and-restore verification, and sustained concurrency testing.
