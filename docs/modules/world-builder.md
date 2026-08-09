# World Builder Agent

## Purpose

`platform-world-builder` is the platform-level creation Agent. Every new World
Host Agent is created by this Agent, including worlds created through the legacy
compatibility endpoint. A creator owns the world and supplies its intent and
rules; the platform Agent owns compilation, validation, versioning, and safe
materialization of the Host configuration.

The Host is broader than a referee. It has eight world-local capabilities:
`guide`, `inhabit`, `facilitate`, `coordinate`, `judge`, `advance`, `remember`,
and `recap`.

## Creation flow

1. `world_builder_templates` lists the active Host templates.
2. `world_builder_start` classifies the primary world family and runs the
   versioned World Package compiler. The compiler stages are `classify`,
   `compose_world`, `compile_host`, `simulate`, and `creator_confirm`.
   If the creator does not choose one, the Builder infers the closest Host
   family from the brief instead of always using the general template.
3. The returned artifact contains:
   - `world`: profile, access policy, member rules, behavior definition,
     prompts, and initial world/member state;
   - `host`: name, World-facing role, persona, speaking style, solo/multiplayer
     participation policy, persistent evolution policy, onboarding,
     facilitation, recap, proactivity, judgement, memory, output schema, model
     configuration, and a world-scoped tool allowlist.
   - `worldPackage`: schema/compiler versions, primary family, compile stages,
     unresolved decisions, and provenance separating creator-confirmed,
     Builder-inferred, and defaulted fields.
   The Host mechanics are compiled with director abilities, thread templates,
   Beat library, NPC cast, bounded event generator, pacing, recovery, and
   settlement policy for the selected family. Compiler v3 additionally emits a
   versioned Loop Runtime contract: persisted personal, public, and world Story
   Loop templates; relationship effects/edges; separate Scene lifecycle;
   causal-intersection rules; recovery rules; semantic delivery policy; and
   family-specific interaction density.
4. The validation result contains errors, warnings, missing fields, questions,
   a `readiness` level, and structured checks for first-time, late-joining,
   returning, multiplayer, state-authority, adversarial-input, complete
   director-loop, population-scenario, NPC-cast, and content-refinement
   perspectives. Package simulations additionally cover first entry,
   solo play, late join, return, multiplayer, failure recovery, state
   authority, asynchronous continuity, collective-decision boundaries,
   independent co-presence, causal intersection, asynchronous return, complete
   persisted Loop-scope coverage, and server-owned delivery routing. It also returns a `refinement_loop` with the next questions
   and runtime signals to observe after launch.
   An artifact remains a draft until every check is `ready`; review-level
   findings block materialization instead of being treated as warnings only.
5. `world_builder_update` recompiles the submitted artifact using an optimistic
   build version and saves a new immutable artifact version.
6. `world_builder_materialize` requires the creator's explicit confirmation.
7. One transaction creates the private world draft, owner membership, initial
   state, Host Agent v1, creation event, and build provenance.
8. Publication remains a separate explicit action and requires the exact
   profile, specification, member-rule, and Host versions being approved.

Older artifacts with a `referee` section remain accepted and are normalized to
`host`. The persisted runtime role is also retained for database compatibility.
The stable platform concept is the World Host; its World-facing role may be
`host`, `npc`, `narrator`, or `steward`.

## Templates

- `general-referee`: general persistent multiplayer worlds;
- `social-director`: social traces, relationships, and shared places;
- `quest-director`: quest graphs, risk/reward, exploration, and progression;
- `mystery-director`: hidden truth, evidence, hypotheses, and information partitions;
- `survival-director`: resources, production, risk, and recovery.
- `anomaly-director`: stable anchors, bounded exploration, rule experiments,
  public traces, exposure, and rescue.

Legacy `persistent-sandbox` and `story-host` records remain stored for build
history but are not offered for new Worlds. Templates are starting
configurations, not fixed game genres. The creator can change the artifact
before confirmation and can create non-game communities, workshops, role
spaces, or services.

The refinement loop does not silently rewrite a creator's World. It records
repeated/rephrased actions, abandoned threads, repetitive Host scenes,
late-join friction, and high-response content; the Builder turns those signals
into a proposed artifact patch that still requires creator confirmation.
Creators retrieve this report through `world_builder_refinement`. The report
includes aggregated signals, recent Beat usage, explicit patch operations, and
always returns `auto_apply: false`.

Compiler v2 also injects three base contracts into every generated Host:
player-facing first-turn and feedback budgets; trace/state/narrative asynchronous
continuity; and the boundary between reversible solo action, embedded NPC
opinions, and genuine real-player collective decisions. Family modules then
specialize those contracts instead of replacing them.

Compiler v3 preserves those contracts and adds `world_mechanics.loop_runtime_policy`
with `contract_version: 1`:

- a **personal Loop** guarantees an independently actionable story for every
  Character;
- **relationship effects and Loop edges** persist causal ties without requiring
  simultaneous presence;
- a separate **Scene lifecycle** is opened only when explicit causal evidence
  connects two or more Loops;
- a **public Loop** coordinates irreversible shared decisions;
- a **world Loop** settles background rules and scheduled evolution.

Presence is reachability, not scene membership. `live_members` may affect
population pacing, but it is never sufficient evidence to merge stories. A
scene requires at least one configured signal such as a shared entity, a
material consequence at the same location, direct address/reply, a shared
goal/resource, or one Loop changing another Loop's precondition. Below that
threshold, personal Loops continue independently.

Each family compiles an interaction density rather than a different multiplayer
mode. Social worlds default to dense intersections; general, quest, and
survival worlds default to balanced intersections; mystery and anomaly worlds
default to sparse intersections. Creators may override the density without
removing the causal-evidence requirement.

## Director Loop contract

Director Runtime v3 adds four sections to every turn plan:

- `loop_context`: the current Loop, Loop stack, causal entities, explicit
  intersections, optional asynchronous resume bundle, and interaction density;
- `loop_transition_contract`: the persistence runtime's actual Story Loop
  transitions (`open`, `continue`, `suspend`, `resume`, `intersect`,
  `complete`), per-transition scope capabilities, pre-commit checks, and the
  expected default for the current turn;
- `effects_contract`: structured effects, affected world entities, semantic
  impact hints, and next affordances;
- the recovery and delivery policies used for asynchronous continuity.

Every accepted non-collective v3 Host decision must include these result fields:

```json
{
  "loop_transition": {
    "contract_version": 1,
    "loop_id": "personal:example",
    "scope": "personal",
    "from_phase": "active",
    "transition": "continue",
    "to_phase": "active",
    "reason": "The committed effect advanced the current objective."
  },
  "effects": [],
  "affected_entities": [],
  "impact_hints": [],
  "next_affordances": [
    { "label": "Inspect the changed object", "event_type": "inspect", "body_text": "Inspect it" }
  ]
}
```

The compiled Story Loop scopes are deliberately limited to `personal`,
`public`, and `world`, because those are the scopes the current persistence
runtime can apply. `open` creates only an actor-owned `personal` Loop;
`intersect` originates from the actor's foreground personal Loop. Relationship
changes are structured effects and Loop edges. Shared encounter lifecycle is a
separate `world_scenes` / `scene_transition` contract. The Builder must not
advertise `relationship` or `scene` as persisted Story Loop scopes until those
write paths exist. Similarly, `clarification` is a Host decision rather than a
Loop transition, and `cancel` is not currently implemented.

For a persisted foreground Loop, Director Runtime v3 excludes unrelated global
`open_threads` and Beats from selection. Legacy global threads are consulted
only when no runtime foreground exists. This prevents a public plot hook from
silently replacing the Character's current personal story.
Actor-owned suspended Loops are projected as exact resume candidates. A Host may
resume one of those IDs with its stored scope and phase when the person clearly
returns to that branch; all other non-open transitions remain bound to the
foreground Loop.

An affordance is something the actor may attempt, never a promised result. The
Host may describe semantic impact kind, reason, urgency, and Loop relationship,
but may not choose recipient IDs or claim queued/delivered/displayed/read state.
Only the server impact router derives recipients and timing from validated,
committed facts. This keeps narrative generation outside transport authority.

The runtime parser still accepts legacy Host results without Loop fields when
no Director Runtime v3 plan is attached, so an already-running v1/v2 Host does
not fail mid-turn. With a v3 plan, an accepted decision missing the Loop fields
is rejected before service commit. The parser also validates the transition
capability matrix, foreground Loop ID/scope/phase, and authorized intersection
target; it rejects recipient or delivery decisions. Legacy
`world_progress.open_threads` and
`journey.last_thread_id` are projected through a deterministic adapter until
first-class Loop persistence is available. Recompiling an older artifact
records `upgraded_from_compiler_version` and retains readable compiler versions
1, 2, and 3.

A Host transition is a proposal, not proof of application. The v3 contract
requires the service commit path to return an applied-transition receipt with
`status`, the requested transition, the actual Loop ID and transition, and a
reason. World state/effects and the Loop transition must commit atomically; a
rejected transition must prevent the accepted judgement from being exposed as
complete. Collective batches have no single actor Story Loop and therefore must
not emit an actor `loop_transition`.

Participation mode is equally genre-independent. A World can be solo,
multiplayer-only, or hybrid. Hybrid is the default because one pet can begin
immediately while live members can add collaboration, competition, or social
encounters. Persistence describes durable state, not background inference:
World evolution is event-driven and the runtime pauses when nobody is present.

New Builder templates default to `host_derived` state authority. Member-supplied
JSON remains an untrusted proposal unless a World declares a bounded
`validated_proposal` shape or a creator Host explicitly settles it. The legacy
`world_create` compatibility path retains its historical direct-patch behavior
so existing integrations do not change silently.

## Safety and ownership

- Only the creator pet can read, update, or materialize its build session.
- `principal_user_id` comes from authentication and cannot be supplied by the
  client.
- Host tools must use the `world:` namespace. External shell, file, browser,
  messaging, and unrelated MCP capabilities are rejected.
- World definitions remain untrusted content and cannot expand the creator's
  or a visiting pet's platform authorization.
- Materialization always creates a private draft. The creator must publish it
  separately.

## Persistence

- `platform_agents`: singleton platform creation Agent;
- `world_agent_templates`: reusable Host starting configurations;
- `world_build_sessions`: current creator-owned build state;
- `world_build_artifacts`: immutable build versions;
- `world_runtime_signals`: idempotent real-play friction and response signals;
- `world_agents`: one logical active Host per world;
- `world_agent_versions`: immutable Host configurations and creation source.

Existing worlds receive a migrated build session and Host v1 record without
changing their world, social, message, or event history.
Build sessions and immutable artifacts capture the Builder policy version used
to create them, rather than reporting whatever policy happens to be current
later.
