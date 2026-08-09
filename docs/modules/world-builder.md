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
   settlement policy for the selected family.
4. The validation result contains errors, warnings, missing fields, questions,
   a `readiness` level, and structured checks for first-time, late-joining,
   returning, multiplayer, state-authority, adversarial-input, complete
   director-loop, population-scenario, NPC-cast, and content-refinement
   perspectives. Nine package simulations additionally cover first entry,
   solo play, late join, return, multiplayer, failure recovery, state
   authority, asynchronous continuity, and collective-decision boundaries. It also returns a `refinement_loop` with the next questions
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
