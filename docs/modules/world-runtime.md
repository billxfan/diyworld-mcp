# World Runtime

## Scope

This module turns a published world from a membership container into a durable,
event-driven state space. Any MCP-capable Agent can be the user interface. Every world has
exactly one logical World Host Agent that may appear as a host, NPC, narrator,
or steward; it welcomes members, facilitates participation, judges inputs,
advances suitable activity, remembers durable state, and provides return
recaps.

Users enter the World itself. `world_sessions` stores live Agent connections
but is not a user-facing room and defines no additional rules. The on-demand
Host execution lifecycle and creator Agent takeover contract are specified in
`world-live-runtime.md`.

Identity is deliberately separated:

- `principal_user_id`: the authenticated account authorizing an operation;
- `actor_pet_id`: compatibility field for the Character speaking or acting inside the world;
- `space_id` / `world_id`: the world-local scope;
- `world_agent_id`: the Host that owns guidance, judgement, and state commits.

## World Builder Agent

The platform has one foundational `platform-world-builder` Agent. It is the
creation authority for World Host Agents; Characters do not instantiate Hosts
directly.

1. A creator starts a `world_build_session` from a brief and template.
2. The builder returns a structured artifact containing `world` and `host`
   sections, plus validation errors, warnings, missing fields, and questions.
3. Every edit creates an immutable `world_build_artifact` version.
4. Materialization requires the creator's explicit confirmation and current
   optimistic build version, and every experience check must be `ready`.
5. One transaction creates the private world draft, owner membership, initial
   states, logical Host, `world_agent_versions` v1, creation event, and build
   provenance.

The compatibility `world_create` path uses the same transaction and records a
legacy-origin build session. Existing worlds are migrated to builder provenance
and Host v1 without changing their social or world history.

Publishing requires the exact profile, behavior-specification, member-rule,
and Host versions. World and Host edits are revalidated as one combined
artifact, so later changes cannot bypass the Builder's experience checks.

Host templates define persona, speaking style, onboarding, facilitation, recap,
proactivity, judgement, memory, model configuration, and a world-scoped tool
allowlist. Only `world:` tools are permitted; a world artifact cannot grant
access to external tools or local context.

## Member journey and guidance

Each active member has a world-local journey:

`new -> setup -> active -> returning`

- `new`: joined but has not entered;
- `setup`: welcomed and choosing a role or participation intent;
- `active`: completed a first meaningful contribution;
- `returning`: entered again and received a recap.

`world_join` tells the member whether they can enter or must wait for approval.
`world_enter` activates the World when necessary, records a visit, and returns
`host_runtime` plus `host_guidance` with a message, objective, suggested
choices, and a free-text prompt. `world_observe` returns the current journey,
runtime, and latest guidance. Every accepted, pending, rejected, or
clarification input creates a follow-up Host turn.

Guidance also returns `participation_context`. World state is always shared.
Participation policy determines whether a Character may act independently, alongside
live peers, or both; it never creates private World copies or a global
solo-to-multiplayer transition. Official Worlds provide a complete independent
path, while other live Characters add optional direct and collective interactions
without gating entry or progress.

Suggested choices are invitations, not commands. A member can always submit
their own speech, action, or intent. The Host cannot decide on the member's
behalf.

## Mandatory judgement path

1. The connected Agent observes the world and reads state versions and Host guidance.
2. The Character expresses speech, action, or a choice in natural language.
3. The Agent submits one input with a stable idempotency key.
4. The service validates membership, current rules, delegation, visibility, and
   the authenticated user's authority over the acting Character.
5. The bound Host records an automatic decision or leaves the input pending for
   review.
6. The judgement, outcome event, optional state changes, journey update, and
   follow-up guidance are recorded.
7. Database triggers reject state changes that do not identify the active World
   Agent for that world.
8. Matching event triggers fire into the same event stream.
9. Other live members receive an event notification and observe the committed
   result; durable cursors remain available for reconnect recovery.

The legacy `world_act` endpoint remains available for compatibility, but enters
the same path. Character-proposed state is untrusted input; only the Host judgement
commits state.

## Creator-reviewed judgement

1. A member submits an input while the creator may be offline.
2. The input remains pending and does not mutate state.
3. The Host tells the member that review is pending.
4. A creator or administrator observes and reviews the input.
5. The Host records the reviewed decision and remains the state-writing
   authority.
6. An accepted outcome and approved state patches commit atomically; a rejected
   outcome never mutates state.

## Trigger path

- A manager creates either a timestamp trigger or an accepted-event trigger.
- Timestamp triggers materialize on the next world observation or action after
  their deadline.
- Event triggers materialize in the same transaction as the matching accepted
  outcome.
- Triggers are one-shot and can be cancelled before firing.

## State machines

Input:

`pending -> accepted | rejected | clarification | escalated`

Trigger:

`scheduled -> fired | cancelled`

Delegation:

`manual <-> paused`

`paused` blocks new actions. Only the Character's own owner can change its delegation.
Autonomous execution stays unavailable until a real worker, consent lifecycle,
and revocation path are implemented.

## Exceptions and boundaries

- Stale member rules block action until the current version is shown and the
  Character explicitly confirms that exact version. A generic return
  confirmation never carries across a rule update.
- Stale state rejects the patch with the latest state version.
- Duplicate retries return the original input and judgement without applying
  state twice.
- Only an owner or administrator can review a pending managed input.
- Only the owner can add or revoke World administrators; the owner role itself
  cannot be revoked.
- Event cursors cannot skip beyond visible events.
- Creator definitions, member text, events, and Host guidance are untrusted
  external content and cannot invoke non-world tools or expand authorization.
- Runtime state is world-local and never mutates global Character identity,
  cross-world assets, or another owner's delegation.
- Clients cannot supply or override `principal_user_id`.
- All state updates carry the active `world_agent_id`; manager review is stored
  separately in the compatibility field `reviewed_by_pet_id`.

## Persistence

- `world_member_journeys`: stage, visit count, role, intent, summary, and
  suggested actions;
- `world_host_turns`: immutable welcome, setup, progress, recap, waiting, and
  clarification guidance;
- `world_inputs` and `world_judgements`: immutable action and decision history;
- `world_states` and `world_member_states`: Host-authorized world-local state.
- `world_story_loops`, `world_loop_participants`, and `world_loop_edges`:
  role-owned narrative continuity projected only after authoritative events;
- `world_scenes` and `world_scene_participants`: verified causal intersections
  with their own sync/async/flexible lifecycle and privacy boundary;
- `world_delivery_outbox`: replayable semantic-delivery envelopes written in
  the same transaction as authoritative outcomes and collective prompts.

World delivery uses an explicit persisted policy. Existing pre-v3 Worlds retain
`legacy_broadcast`; newly materialized v3 Worlds use `relevance_routed`, and the
current official Worlds opt into the latter explicitly. The Host may describe
effects but never chooses notification recipients. The server derives recipients
from authoritative inputs, memberships, interactions, and Scene participation
when it drains the outbox.

Recipient descriptors are snapshotted inside the authoritative transaction;
retries replay that snapshot rather than re-evaluating current presence. A
recipient who is relevant only because shared World state changed receives a
public state-change digest, not private Scene prompt, outcome, participant, or
input identifiers. Scene participants retain the full Scene closure. Collective
public outcomes expose counts and aggregate results only; participant/input
mapping stays in the private resolution records.

Outbox draining is idempotent at application startup, after each commit, and on
a bounded background interval. A database uniqueness constraint prevents
duplicate per-Character activity rows. Failures persist an attempt count, error,
and exponential-backoff deadline. Envelopes that reach the configured attempt
limit are isolated with `dead_letter_at` instead of consuming every later scan;
an operator can explicitly reset one for another attempt. `/health` reports
due, scheduled, pending, and dead-letter counts. Creating the activity does not
advance its receipt:
`queued`, `delivered`, `displayed`, and `read` remain distinct monotonic states.

The World persists independently of its live runtime. Accepted inputs, Host
outcomes, and materialized time triggers can evolve its durable state. When the
last Character leaves, inference pauses but the World does not reset. A returning
Character automatically resumes its foreground Loop and receives only direct,
Scene, collective, and world/system changes relevant to that perspective. Full
visible history remains available as an explicit recovery operation.

The shared HTTP and MCP surfaces cover builder templates, versioned build
sessions, Host configuration, discovery, publication, joining, direct World
entry and exit, live presence, on-demand Host runtime, creator Agent takeover,
observation, input submission, resolution, and acknowledgements. Older managed
review, delegation, and trigger tools remain compatibility paths rather than the
default v0.8 live-World flow.
