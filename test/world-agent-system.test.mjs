import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectorTurnPlan,
  compileWorldPackage,
  directorFamilyModules,
  simulateWorldPackage,
  WORLD_BUILDER_COMPILER_VERSION,
  WORLD_DIRECTOR_RUNTIME_VERSION,
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
  assert.ok(mechanics.director_abilities.length >= 3);
  assert.ok(mechanics.thread_templates.length >= 3);
  assert.ok(mechanics.beat_library.length >= 2);
  assert.equal(Object.keys(mechanics.async_continuity_policy.layers).length, 3);
  assert.match(mechanics.collective_decision_policy.npc_role, /不计作真人/u);
  assert.ok(artifact.world.initialWorldState.world_progress);
  assert.ok(artifact.world.initialMemberState.journey);
  assert.equal(simulateWorldPackage(artifact).valid, true);
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
  assert.match(first.continuity_contract.idle, /暂停/u);
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
