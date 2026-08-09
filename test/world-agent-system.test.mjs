import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectorTurnPlan,
  compileWorldPackage,
  directorFamilyModules,
  simulateWorldPackage,
  WORLD_BUILDER_COMPILER_VERSION,
  WORLD_DIRECTOR_RUNTIME_VERSION,
  WORLD_LOOP_CONTRACT_VERSION,
  WORLD_LOOP_SCOPES,
  WORLD_LOOP_TRANSITION_CAPABILITIES,
  WORLD_LOOP_TRANSITIONS,
} from "../src/venue-lab-core/world-agent-system.js";

function baseHost(family = "quest") {
  return {
    name: "测试导演",
    judgementPolicy: {
      state_writes: "referee_only",
      population_policy: {
        zero_players: "pause",
        one_player: "solo",
        few_players: "few",
        many_players: "many",
        late_join: "side-door",
        returning: "recap",
      },
      npc_policy: {
        mode: "host_embedded_cast",
        separate_agent_default: false,
      },
      world_mechanics: { family },
    },
    onboardingPolicy: {
      starter_choices: [{ id: "a" }, { id: "b" }],
      free_input_prompt: "自由行动",
    },
    facilitationPolicy: {},
    recapPolicy: { enabled: true },
  };
}

test("the compiler emits a versioned World Package and fills family modules", () => {
  const artifact = compileWorldPackage({
    briefText: "一个裂隙任务世界",
    templateId: "quest-director",
    family: "quest",
    baseArtifact: {
      world: {
        name: "边境公会",
        rulesText: "玩家描述尝试，由 Host 裁决。",
        definitionText: "承接任务并探索边境。",
      },
      host: baseHost("quest"),
    },
    suppliedArtifact: {
      world: { description: "可单人或多人异步探险。" },
    },
  });

  assert.equal(artifact.worldPackage.schema_version, 1);
  assert.equal(artifact.worldPackage.compiler_version, WORLD_BUILDER_COMPILER_VERSION);
  assert.equal(artifact.worldPackage.primary_family, "quest");
  assert.ok(
    artifact.worldPackage.provenance.creator_confirmed_paths.includes(
      "world.description",
    ),
  );
  const mechanics = artifact.host.judgementPolicy.world_mechanics;
  assert.equal(mechanics.family, "quest");
  assert.equal(
    artifact.worldPackage.loop_contract_version,
    WORLD_LOOP_CONTRACT_VERSION,
  );
  assert.ok(mechanics.director_abilities.length >= 3);
  assert.ok(mechanics.thread_templates.length >= 3);
  assert.ok(mechanics.beat_library.length >= 2);
  assert.equal(Object.keys(mechanics.async_continuity_policy.layers).length, 3);
  assert.match(mechanics.collective_decision_policy.npc_role, /不计作真人/u);
  assert.deepEqual(
    mechanics.loop_runtime_policy.loop_templates.map((loop) => loop.scope),
    WORLD_LOOP_SCOPES,
  );
  assert.deepEqual(
    mechanics.loop_runtime_policy.transition_contract.capabilities,
    WORLD_LOOP_TRANSITION_CAPABILITIES,
  );
  assert.deepEqual(
    mechanics.loop_runtime_policy.transition_contract.legal_transitions,
    WORLD_LOOP_TRANSITIONS,
  );
  assert.ok(!WORLD_LOOP_TRANSITIONS.includes("cancel"));
  assert.ok(!WORLD_LOOP_TRANSITIONS.includes("clarify"));
  assert.equal(
    mechanics.loop_runtime_policy.delivery_policy.authority,
    "server_impact_router",
  );
  assert.ok(artifact.world.initialWorldState.world_progress);
  assert.ok(artifact.world.initialMemberState.journey);
  assert.equal(simulateWorldPackage(artifact).valid, true);
  for (const scenario of [
    "independent_multiplayer",
    "causal_intersection",
    "async_return",
    "loop_scope_coverage",
    "loop_capability_truthfulness",
    "delivery_authority",
  ]) {
    assert.equal(
      simulateWorldPackage(artifact).scenarios.find((item) => item.id === scenario)?.status,
      "pass",
      scenario,
    );
  }
});

test("the compiler records a non-destructive upgrade path from v2 artifacts", () => {
  const artifact = compileWorldPackage({
    family: "general",
    baseArtifact: {
      world: {
        name: "旧世界",
        rulesText: "只决定自己的行动。",
        definitionText: "一个旧版本世界。",
      },
      host: baseHost("general"),
      worldPackage: { schema_version: 1, compiler_version: 2 },
    },
  });
  assert.equal(
    artifact.worldPackage.compatibility.upgraded_from_compiler_version,
    2,
  );
  assert.deepEqual(
    artifact.worldPackage.compatibility.readable_compiler_versions,
    [1, 2, WORLD_BUILDER_COMPILER_VERSION],
  );
  assert.ok(artifact.world.initialWorldState.loop_runtime);
  assert.ok(artifact.world.initialMemberState.loop_runtime);
});

test("creator mechanics override defaults without erasing the rest of the family", () => {
  const artifact = compileWorldPackage({
    templateId: "survival-director",
    family: "survival",
    baseArtifact: { world: {}, host: baseHost("survival") },
    suppliedArtifact: {
      host: {
        judgementPolicy: {
          world_mechanics: {
            pacing_model: { baseline: "custom-cycle" },
          },
        },
      },
    },
  });
  const mechanics = artifact.host.judgementPolicy.world_mechanics;
  assert.equal(mechanics.pacing_model.baseline, "custom-cycle");
  assert.ok(mechanics.recovery_model.failure);
  assert.ok(mechanics.event_generator.rules.length >= 3);
});

test("the Director Runtime deterministically selects an open thread and Beat", () => {
  const modules = directorFamilyModules("quest");
  modules.beat_library[0].id = "echo-lamp";
  const host = {
    judgement_policy: {
      population_policy: {
        one_player: "solo-complete",
        few_players: "async-party",
        many_players: "parallel",
        returning: "recap",
      },
      npc_policy: { cast: modules.npc_cast },
      world_mechanics: { family: "quest", ...modules },
    },
  };
  const params = {
    host,
    worldState: {
      value: {
        world_progress: {
          open_threads: [
            { id: "other", state: "open", beat: "unknown" },
            { id: "echo-lamp", state: "progressing", beat: "echo-lamp" },
          ],
        },
      },
    },
    memberState: { value: { journey: { stage: "active" } } },
    context: { live_members: [{ pet_id: "actor" }], actor_journey: { stage: "active", last_thread_id: "echo-lamp" } },
    input: { id: "turn-1", event_type: "quest.echo-lamp", body_text: "继续回声灯任务" },
  };
  const first = buildDirectorTurnPlan(params);
  const second = buildDirectorTurnPlan(params);
  assert.deepEqual(first, second);
  assert.equal(first.population.scenario, "one_player");
  assert.equal(first.selection.thread.id, "echo-lamp");
  assert.equal(first.selection.beat.id, "echo-lamp");
  assert.equal(first.selection.source, "thread_beat_match");
  assert.equal(first.contract_version, WORLD_DIRECTOR_RUNTIME_VERSION);
  assert.equal(first.loop_context.contract_version, WORLD_LOOP_CONTRACT_VERSION);
  assert.equal(first.loop_context.current_loop.id, "echo-lamp");
  assert.equal(first.loop_context.intersection_state, "independent");
  assert.equal(first.loop_transition_contract.expected_default, "continue");
  assert.equal(
    first.effects_contract.recipient_authority,
    "server_impact_router",
  );
  assert.match(first.continuity_contract.idle, /暂停/u);
});

test("live members alone do not intersect loops, while explicit causal overlap does", () => {
  const mechanics = { family: "social", ...directorFamilyModules("social") };
  const base = {
    host: {
      judgement_policy: {
        population_policy: { few_players: "parallel" },
        world_mechanics: mechanics,
      },
    },
    worldState: { value: { world_progress: { open_threads: [] } } },
    memberState: { value: { journey: { stage: "active" } } },
    input: { id: "two-online", event_type: "action", body_text: "整理自己的花圃" },
  };
  const independent = buildDirectorTurnPlan({
    ...base,
    context: { live_members: [{ pet_id: "a" }, { pet_id: "b" }] },
  });
  assert.equal(independent.population.scenario, "few_players");
  assert.equal(independent.loop_context.intersection_state, "independent");
  assert.equal(independent.loop_transition_contract.expected_default, "open");

  const intersected = buildDirectorTurnPlan({
    ...base,
    context: {
      live_members: [{ pet_id: "a" }, { pet_id: "b" }],
      loop_context: {
        causal_intersections: [
          {
            signal: "same_world_entity",
            entity_ref: "garden:shared-well",
            target_loop_id: "loop:b",
          },
        ],
      },
    },
  });
  assert.equal(
    intersected.loop_context.intersection_state,
    "causal_overlap_detected",
  );
  assert.equal(intersected.loop_transition_contract.expected_default, "intersect");
});

test("returning players receive an explicit resume Loop transition contract", () => {
  const mechanics = { family: "general", ...directorFamilyModules("general") };
  const plan = buildDirectorTurnPlan({
    host: {
      judgement_policy: {
        population_policy: { returning: "recap" },
        world_mechanics: mechanics,
      },
    },
    worldState: { value: { world_progress: { open_threads: [] } } },
    memberState: { value: { journey: { stage: "returning" } } },
    context: {
      actor_journey: { stage: "returning" },
      resume_bundle: { unseen_direct: 1, unseen_current_loop_impact: 2 },
    },
    input: { id: "return", event_type: "world.return", body_text: "继续" },
  });
  assert.equal(plan.loop_transition_contract.expected_default, "resume");
  assert.deepEqual(plan.loop_context.resume_bundle, {
    unseen_direct: 1,
    unseen_current_loop_impact: 2,
  });
});

test("sparse worlds require the compiled causal-intersection threshold", () => {
  const mechanics = { family: "mystery", ...directorFamilyModules("mystery") };
  const plan = buildDirectorTurnPlan({
    host: { judgement_policy: { world_mechanics: mechanics } },
    worldState: { value: { world_progress: { open_threads: [] } } },
    memberState: { value: { journey: { stage: "active" } } },
    context: {
      loop_context: {
        causal_intersections: [
          { signal: "same_world_entity", entity_ref: "evidence:ledger" },
        ],
      },
    },
    input: { id: "sparse", event_type: "inspect", body_text: "核对账本" },
  });
  assert.equal(plan.loop_context.intersection_threshold, 2);
  assert.equal(
    plan.loop_context.intersection_state,
    "causal_overlap_below_threshold",
  );
  assert.equal(plan.loop_transition_contract.expected_default, "open");
});

test("the Director adapts persisted actor Loop context into the v3 turn contract", () => {
  const mechanics = { family: "social", ...directorFamilyModules("social") };
  const foreground = {
    id: "loop:persisted",
    scope: "personal",
    phase: "active",
    status: "active",
  };
  const plan = buildDirectorTurnPlan({
    host: { judgement_policy: { world_mechanics: mechanics } },
    worldState: { value: { world_progress: { open_threads: [] } } },
    memberState: { value: { journey: { stage: "active" } } },
    context: {
      actor_loop_context: {
        foreground_loop: foreground,
        active_loops: [foreground],
        intersection: {
          candidates: [
            {
              id: "edge:well",
              target_loop_id: "loop:shared-well",
              relation_type: "intersection_candidate",
            },
          ],
        },
      },
    },
    input: { id: "persisted", event_type: "act", body_text: "查看共享水井" },
  });
  assert.equal(plan.loop_context.current_loop.id, foreground.id);
  assert.deepEqual(plan.loop_context.loop_stack, [foreground]);
  assert.equal(plan.loop_context.intersection_state, "causal_overlap_detected");
  assert.equal(plan.loop_transition_contract.expected_default, "intersect");
});

test("a persisted foreground Loop cannot be hijacked by a global thread or unrelated Beat", () => {
  const mechanics = { family: "quest", ...directorFamilyModules("quest") };
  mechanics.beat_library[0] = {
    ...mechanics.beat_library[0],
    id: "global-crisis",
    trigger: "global-crisis",
  };
  const foreground = {
    id: "loop:personal-map",
    scope: "personal",
    phase: "active",
    title: "完成自己的旧地图",
  };
  const plan = buildDirectorTurnPlan({
    host: { judgement_policy: { world_mechanics: mechanics } },
    worldState: {
      value: {
        world_progress: {
          open_threads: [
            { id: "global-crisis", state: "open", beat: "global-crisis" },
          ],
        },
      },
    },
    memberState: { value: { journey: { stage: "active" } } },
    context: {
      actor_loop_context: {
        foreground_loop: foreground,
        active_loops: [foreground],
      },
    },
    input: {
      id: "stay-personal",
      event_type: "global-crisis",
      body_text: "global-crisis 继续处理地图",
    },
  });
  assert.equal(plan.selection.thread.id, foreground.id);
  assert.equal(plan.selection.beat, null);
  assert.equal(plan.selection.source, "foreground_loop");
  assert.match(plan.selection.foreground_precedence, /authoritative/u);
  assert.equal(plan.selection.recovery_reason, null);
});

test("creator overrides cannot advertise unsupported Loop scopes or transitions", () => {
  const artifact = compileWorldPackage({
    family: "general",
    baseArtifact: {
      world: {
        name: "真实能力世界",
        rulesText: "仅声明真实能力。",
        definitionText: "测试运行时能力边界。",
      },
      host: baseHost("general"),
    },
    suppliedArtifact: {
      host: {
        judgementPolicy: {
          world_mechanics: {
            loop_runtime_policy: {
              loop_templates: [
                { id: "fake-scene", scope: "scene", phases: ["active"] },
                { id: "real-personal", scope: "personal", phases: ["active"] },
              ],
              transition_contract: {
                legal_transitions: ["cancel", "clarify"],
                legal_scopes: ["relationship", "scene"],
              },
            },
          },
        },
      },
    },
  });
  const policy =
    artifact.host.judgementPolicy.world_mechanics.loop_runtime_policy;
  assert.deepEqual(policy.transition_contract.legal_transitions, WORLD_LOOP_TRANSITIONS);
  assert.deepEqual(policy.transition_contract.legal_scopes, WORLD_LOOP_SCOPES);
  assert.deepEqual(
    policy.loop_templates.map((template) => template.scope),
    ["personal"],
  );
});

test("the Director Runtime uses the declared recovery path when no thread is open", () => {
  const mechanics = { family: "social", ...directorFamilyModules("social") };
  const plan = buildDirectorTurnPlan({
    host: {
      judgement_policy: {
        population_policy: { one_player: "solo" },
        npc_policy: { cast: mechanics.npc_cast },
        world_mechanics: mechanics,
      },
    },
    worldState: { value: { world_progress: { open_threads: [] } } },
    memberState: { value: { journey: { stage: "active" } } },
    context: { live_members: [{ pet_id: "actor" }] },
    input: { id: "empty-world", event_type: "action", body_text: "看看周围" },
  });
  assert.equal(plan.selection.recovery_reason, "no_open_thread");
  assert.equal(plan.recovery, mechanics.recovery_model.deadlock);
  assert.equal(plan.selection.source, "deterministic_beat_rotation");
});
