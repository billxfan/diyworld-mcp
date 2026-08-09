# World Live Runtime

## Product model

Users enter a World directly. There is no user-facing room nested below a
World.

A World combines:

- durable rules and definition;
- shared World and member state;
- membership and live presence;
- one logical World Host Agent;
- an on-demand Host runtime.

`world_sessions` is an internal connection record for Agent sessions and devices.
It is not a separate content container and owns no rules. Speech, actions, and
choices remain World inputs and inherit the current World rules.

## Runtime lifecycle

The Host runtime has two lifecycle states:

`idle -> active -> idle`

- `idle`: nobody is currently inside the World. Durable state and history
  remain available, but no Host inference is running.
- `active`: at least one Character has entered the World. Guidance, judgement, event
  delivery, and creator takeover are available.

The first live entry activates the runtime. The last live exit returns it to
idle. Moving to another World closes the Character's previous World sessions and
reconciles both runtimes.

Repeated `world_enter` calls while the Character is already present are idempotent:
they may attach another client session but do not increment the visit count,
rewrite the original presence timestamp, or manufacture a return recap.
Explicit leave, cross-World movement, rule replacement, World closure, and TTL
expiry all record the departure time and event cursor before removing presence.

Live presence and interaction depth are separate concepts. World state is
always shared: an accepted public action can affect what current and future
members observe even when its actor is working independently. A waiting state
is valid only when the World is explicitly configured to require other members.

Co-present Characters do not cross a global solo-to-multiplayer gate. They may keep
acting independently, speak publicly, respond, or ignore an invitation. The
Host must not manufacture another member's reply or decision. Genuine shared
decisions use an explicit collective interaction with its own response window,
quorum, and optional participation semantics.

Live sessions use a 120-second TTL. The existing Agent device heartbeat, World
observation, input submission, and creator Host operations refresh the session.
If a client disappears without calling `world_leave`, its stale session closes
on the next reconciliation and can no longer keep the World falsely live.

`world_enter` returns the activated `host_runtime` and Host guidance.
`world_leave` closes the current live presence. `world_present` lists the Characters
currently sharing the World.

## Host execution

Every runtime uses the policy
`platform_on_demand_with_creator_takeover`.

The execution path is:

- `platform`: the platform World Host runtime is authoritative while members
  are present. In the validation deployment, every World is bound on demand to
  one persistent local Codex task. One World queue is serial; different World
  queues share a bounded local concurrency pool.
- `creator_codex`: compatibility execution-mode value indicating that an owner
  or administrator has explicitly bound a live Agent
  session as the temporary Host executor.

The logical `world_agent_id` does not change when execution moves between the
platform and creator Agent. Judgements and state commits therefore retain one
stable World-local authority.

The platform binding is stored in `world_host_executors`. Its Codex task is
created on the first pending Host judgement, then reused only for that World.
Each turn receives a freshly assembled World-local context pack containing the
bound World ID, its Host configuration, visible World history, current state,
and the input or ready collective batch being resolved. It does not receive
other Worlds, private messages, shell/files/browser tools, environment
capabilities, or the user's unrelated Codex conversation context. Structured
JSON output is validated and committed through the same transactional World
authority checks as creator-hosted decisions. If Codex execution or validation
fails, the input remains pending and the executor records the failure; it does
not partially update World state.

The creator flow is:

1. enter the World with a stable `client_session_id`;
2. call `world_host_takeover`;
3. renew the 30-300 second lease with `world_host_heartbeat`;
4. read pending inputs with `world_host_next_input`;
5. settle an ordinary input with `world_host_resolve`, or a ready collective
   batch with `world_host_interaction_resolve`;
6. call `world_host_release`, leave the World, or allow the lease to expire.

`world_host_next_input` returns a V2 context pack with recent visible events,
live-member roles and journey stages, the current actor journey, a state
summary, and pending-input count. Actor-visible history is included only for
the actor whose input is currently being judged. `world_host_resolve` supports
accepted, rejected, clarification, and escalated decisions plus structured
facts, costs, hooks, and resolution metadata. Proposed state is not applied by
default; the Agent Host must opt in or provide its own checked patch.

If the creator leaves or the lease expires, execution automatically returns to
the platform. While a creator Agent is active, direct World inputs remain pending
instead of being accepted by the platform policy engine.

## Concurrent input consistency

Every live input carries two version pairs:

- the World and member-state versions the user actually observed while
  composing the input;
- the authoritative versions the server had when it received the input.

The distinction detects both inputs that arrive late and inputs that become
stale while waiting in the Host queue. `world_host_next_input` returns an
`input_concurrency` pack with the observed, received, and current versions plus
the visible World-changing outcomes committed in between.

Fresh inputs use the `apply` disposition. A stale input cannot be committed as
if its old context were still current. The Host must choose one of:

- `rebase`: preserve the user's intent and reinterpret it in current state;
- `absorbed`: another action already achieved or subsumed the intent;
- `conflict`: the intent no longer has a valid meaning and needs clarification;
- `expired`: a bounded response is no longer eligible.

Host resolution always supplies the current World version. The server checks it
inside the same transaction that writes state, judgement, and outcome. State
updates also use a version-qualified SQL update, so a losing Host proposal
cannot partially commit.

The explicit `deterministic` server mode remains available as an operational
rollback path. In that mode, the platform policy automatically rebases speech
and state changes that it derived itself from the latest state. If a stale
action has no safe deterministic reinterpretation, it returns clarification
instead of inventing a second, contradictory fact.

## Collective response windows

Ordinary speech, exploration, and independent actions stay immediate. When a
decision genuinely depends on several members, the active creator Agent Host
can call `world_host_interaction_open` to publish one World-visible prompt with
a bounded collection policy:

- `windowed`: collect until the deadline;
- `quorum`: become ready when the minimum response count is reached, otherwise
  become ready at the deadline.

Every window has a 5-300 second deadline, so a disconnected member cannot block
the World indefinitely. Only one open or ready collective interaction can
exist in a World at a time. A response must reply to the prompt event, and each
Character may contribute once. While open, its returned status is `collecting`; once
ready it is `ready_for_host`.

The World-visible prompt includes the complete participation contract before
any member responds: participation is optional, silence is not agreement, the
quorum or window and relative time to deadline, the late-input policy, the fact
that one response cannot change shared state, and the rule that will coordinate
material disagreement. The same predeclared rule is attached to the aggregate
outcome, so the Host cannot invent a tie-breaker after reading the responses.

`world_host_next_input` prioritizes a ready collective interaction and returns
all pending responses as `input_batch`. The Host cannot settle one response in
isolation. `world_host_interaction_resolve` atomically:

1. records an actor-visible receipt for every response;
2. applies at most one public World-state patch;
3. writes one World-visible aggregate outcome;
4. marks the interaction resolved.

Without creator takeover, a ready batch is sent to the same persistent local
Codex task already bound to that World and follows the same atomic settlement
contract.

The aggregate outcome must preserve participation fairness: it names material
differences between responses, explains the previously declared rule used to
coordinate them, and never describes silence or a split response as unanimous
agreement. Rebased, absorbed, conflicted, or expired work is explained in plain
language with a next action based on the current shared state.

If the World changes while responses are being collected, the whole batch is
stale even when some later responders observed the newer version. The Host must
explicitly rebase, absorb, conflict, or expire the batch before it can commit.
Late responses either become ordinary follow-up inputs (`follow_up`) or are
rejected (`expire`) according to the policy chosen when the window opened.

## Real-time delivery

The MCP calls remain request/response operations. The existing event stream
delivers small wake-up notifications:

- `world.presence_changed`;
- `world.host_runtime_changed`;
- `world.host_input_pending`;
- `world.interaction_opened`;
- `world.interaction_ready`;
- `world.event_committed`.

Notifications contain identifiers and cursors rather than treating member text
as trusted instructions. The connected Agent reads the authoritative World data through MCP
after receiving a notification.

An accepted outcome is persisted before `world.event_committed` is delivered.
Other live members therefore observe one committed result rather than
competing Agent interpretations.

## Security and authority

- Entering the World is required for `world_input_submit`.
- `world_input_submit` always acknowledges receipt through `processing`. A non-final
  response is not a user-facing outcome: the connected Agent calls
  `world_input_result` automatically in bounded long-poll intervals until an
  independent action has a final Host judgement or an explicit processing error.
- A collective response receives immediate progress feedback (response count,
  quorum and/or deadline). Its shared-world effect remains uncommitted until the
  Host publishes the aggregate result.
- Only owners and administrators can take over the Host.
- A takeover is bound to the authenticated user, Character, and exact Agent session.
- Creator Host leases are short-lived and mutually exclusive.
- A Host sees only World-local context and cannot access files, shell, browser,
  private messages, other Worlds, or hidden Agent conversation content.
- The server remains the final state-writing authority and enforces rule,
  state, membership, idempotency, and visibility checks.
- Personalized narration may vary by member perspective, but committed public
  facts come from one outcome event and one authoritative state version.

## Current boundary

The validation runtime depends on one local machine and its Codex app-server.
It provides per-World context isolation and bounded scheduling, but it is not a
1,000-user production execution cluster: sleep, shutdown, network loss, or a
Codex app-server failure pauses every platform Host queue. Moving to production
requires a durable remote worker pool, queue ownership/leases, retries and dead
letters, rate and cost controls, and observability. The deterministic policy
mode is an explicit operational rollback, not a substitute for those controls.

Entry and return recaps are visibility-aware. First-time late joiners receive a
current World snapshot without another member's actor-visible content, while a
returning member's “since last time” recap starts after their recorded departure
sequence instead of taking an arbitrary global tail.
