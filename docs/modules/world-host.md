# World Host Agent

## Product role

Every world owns one versioned World Host Agent. “Host” is the stable platform
concept; inside a particular World it may appear as a host, NPC, narrator, or
steward. Rule judgement is one of its internal capabilities.

The Host is attached directly to the World, not to a nested room or
conversation. Conversation is an event stream governed by the World rules.

| Capability | Responsibility |
| --- | --- |
| `guide` | Welcome first-time members and explain what can happen here |
| `inhabit` | Consistently embody a World-local NPC or character role |
| `facilitate` | Offer relevant next actions while preserving free input |
| `coordinate` | Connect multiple live members without making them a prerequisite |
| `judge` | Apply world rules to every speech, action, and choice |
| `advance` | Turn accepted participation into a durable world outcome |
| `remember` | Use durable World and member history to preserve continuity |
| `recap` | Summarize relevant activity when a member returns |

The Host is world-local. It cannot access shell, files, browsers, private
messages, other worlds, or the connected Agent's private conversation context.

Every new Host also carries a director loop: observe shared and member state,
select a player-relevant open thread, frame an actionable scene, adjudicate the
attempt, persist consequences, and seed a follow-up hook. Its population policy
separately covers zero players, one player, a few players, many players,
late-joiners, and returning players.

The Director Runtime v2 compiles those policies into a concrete `director_plan`
for every entry, individual Host input, and collective batch. The plan chooses
the current population scenario, an open thread, a compatible Beat, an embedded
NPC, generator inputs, pacing, recovery, settlement, and the exact scene/output
contract. Selection is deterministic for the same input and state, so retries
do not silently produce a different scene.

Every plan also carries a `continuity_contract`: accepted public actions must
leave a trace, shared-state change, or in-world narrative echo; an empty world
pauses free progression and personal risk; and embedded NPCs do not count as
real-player consent or quorum. Player-facing output acknowledges every submitted
action immediately even when final settlement continues asynchronously.

NPCs are an embedded cast managed by the Host by default, not autonomous Agents.
They must be disclosed as NPCs, cannot impersonate real players, and cannot take
control of a Character. A long-lived NPC should become a separate Agent only
when it genuinely needs an independent goal, memory, and concurrent action.

## Configuration

Each immutable Host version contains:

- name, persona, and speaking style;
- World-facing role: `host`, `npc`, `narrator`, or `steward`;
- participation policy: `solo`, `multiplayer`, or `hybrid`, describing whether
  members may participate independently, alongside live peers, or both;
- evolution policy: persistent event-driven evolution sources and idle
  behavior;
- onboarding policy with welcome text, setup prompt, starter choices, and free
  input;
- facilitation policy with a participation objective and suggested next
  actions;
- judgement and memory policies;
- recap policy and proactivity;
- world-scoped capability and tool allowlists.

Creators and administrators can read or create a new Host version with
optimistic version checks. Official-world Hosts remain platform-managed.

## Guidance contract

`host_guidance` contains:

- `kind`: `welcome`, `setup`, `progress`, `recap`, `waiting`, or
  `clarification`;
- `stage`: current member journey stage;
- Host identity and current objective;
- `participation_context`, which reports that the World state is shared, whether
  the member is currently independent or co-present, whether direct interaction
  is available, and whether a genuine collective prompt is active;
- context summary;
- suggested choices with submit-ready event type, data, and visibility;
- a free-input prompt;
- the current journey.
- a `director_plan` preview for newly generated entry guidance.

Input and entry results additionally expose `host_response`, a stable envelope
with:

- `response_type`: guidance, pending, or judgement;
- `decision`, `reason_text`, and `outcome_text`;
- additive V2 detail: `resolution`, `interpretation`, `new_facts`, `costs`,
  and `opened_hooks`;
- world and member state version changes;
- live member context;
- `next_guidance` using the same `host_guidance` structure.

Choices never bypass judgement. Selecting a role produces a normal immutable
world input, which the Host must accept before the member's world-local role is
written.

Actor-visible choices remain private to that member. A secret requested by
World content is never silently copied into a world-visible event; clients must
preserve the returned visibility or keep the secret unstated.

A World is shared from the start. Co-presence never triggers a global
solo-to-multiplayer switch and never requires all members to consent before
accepted public actions affect the same state. Each Character may keep acting
independently, invite a peer to interact, respond, or ignore an invitation.
Consent is still required for actions whose meaning is inherently mutual, but
it belongs to that specific interaction rather than to World participation.

## Current implementation boundary

During validation, the default platform executor is the creator's local Codex
app-server. Every logical Host receives one persistent Codex task on demand,
bound immutably to a single World. Ordinary inputs and ready collective batches
are serialized within that World; each turn receives only a freshly assembled
World-local context pack and has no external tools. Structured decisions still
pass through server-side authority, visibility, version, and atomic state-commit
checks. A failed or invalid turn leaves its input pending.

Creators can bind their own current Agent session as the temporary executor
through a short-lived lease; direct inputs wait for that Agent until it resolves
or releases the claim. The deterministic platform policy remains an explicit
rollback mode. A production deployment must replace the single local machine
with durable remote Host workers without changing membership, authorization,
or state-writing contracts.

Every settled input also stores one `world_director_turns` record containing
the selected family, population scenario, thread, Beat, complete plan, and
outcome link. This supplies continuity and refinement evidence without granting
the LLM direct state authority. Clarification, rejection, missing follow-up,
stale input, and declared repetition signals are stored idempotently for the
creator-reviewed Builder refinement loop.
