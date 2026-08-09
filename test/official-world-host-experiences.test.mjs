import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_WORLD_VERSION,
  OFFICIAL_WORLDS,
  openDatabase,
  seedOfficialWorlds,
} from "../src/venue-lab-core/database.js";
import { SocialService } from "../src/venue-lab-core/social-service.js";

function createCharacter(db, ownerId, name) {
  const service = new SocialService(db, ownerId);
  service.getOrCreatePet({ name });
  return service;
}

test("the platform publishes five focused solo-first official Worlds", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "official-catalog-visitor", "目录体验者");
  try {
    const catalog = visitor.searchWorlds({ limit: 50 }).worlds;
    assert.equal(catalog.length, 5);
    assert.deepEqual(
      catalog.map((world) => world.id),
      OFFICIAL_WORLDS.map((world) => world.id),
    );
    assert.equal(new Set(catalog.map((world) => world.category)).size, 5);
    assert.equal(new Set(catalog.map((world) => world.shortcut)).size, 5);
    assert.deepEqual(
      catalog.map((world) => world.name),
      ["晨雾镇", "风口集", "钟楼巷 19 号", "白河电站", "失序回廊"],
    );

    for (const definition of OFFICIAL_WORLDS) {
      const world = catalog.find((candidate) => candidate.id === definition.id);
      assert.equal(world.rule_version, OFFICIAL_WORLD_VERSION);
      assert.equal(world.category, definition.category);
      assert.equal(world.shortcut, definition.shortcut);
      assert.match(world.rules_text ?? definition.rules, /只能决定当前 Character/);
      assert.ok(world.definition_text.length > 100);
      assert.equal(world.host_runtime.judgement_contract_version, 2);
    }
  } finally {
    db.close();
  }
});

test("every official World provides an isolated Host and an immediate solo action", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "official-entry-visitor", "首轮体验者");
  try {
    for (const definition of OFFICIAL_WORLDS) {
      visitor.joinWorld({
        worldId: definition.id,
        ruleVersion: OFFICIAL_WORLD_VERSION,
      });
      const entered = visitor.enterWorld({
        worldId: definition.id,
        clientSessionId: `entry:${definition.slug}`,
      });
      assert.equal(entered.world.id, definition.id);
      assert.equal(
        entered.world.world_agent.id,
        `world-agent:${definition.id}`,
      );
      assert.equal(entered.host_guidance.kind, "welcome");
      assert.equal(entered.host_guidance.host.name, definition.host.name);
      assert.match(entered.host_guidance.message, /没有其他真人在线也可以完成完整玩法循环/);
      assert.ok(
        ["action", "choice", "speech"].includes(
          entered.host_guidance.choices[0].input_type,
        ),
      );
      assert.equal(entered.host_guidance.choices.length, 3);
      assert.doesNotMatch(
        `${definition.description} ${entered.host_guidance.host.onboarding_policy.welcome_text} ${entered.host_guidance.choices.map((choice) => choice.label).join(" ")}`,
        /Truth Package|Beat|状态机|置信度|暴露值|推进一个任务节点|可证伪假说/u,
        definition.id,
      );
      assert.equal(entered.host_guidance.live_context.currently_alone, true);
      assert.equal(
        entered.host_guidance.participation_context.participation_style,
        "independent",
      );
      visitor.leaveWorld({ worldId: definition.id });
    }
  } finally {
    db.close();
  }
});

test("every official World has a distinct gameplay loop, state model, and Host contract", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "official-gameplay-visitor", "玩法测试者");
  try {
    const loops = new Set();
    const eventTypes = new Set();
    const uniqueWorldStateKeys = new Set();
    for (const definition of OFFICIAL_WORLDS) {
      const details = visitor.getWorld({ worldId: definition.id });
      const host = visitor.getWorldHost({ worldId: definition.id }).host;
      const mechanics =
        host.judgement_policy.world_mechanics;
      assert.ok(mechanics.core_loop.length > 30, definition.id);
      assert.ok(mechanics.core_tension.length > 10, definition.id);
      assert.ok(mechanics.progression.length > 15, definition.id);
      assert.ok(mechanics.host_directives.length >= 3, definition.id);
      assert.ok(host.judgement_policy.director_loop.length >= 5, definition.id);
      assert.ok(mechanics.director_abilities.length >= 3, definition.id);
      assert.ok(mechanics.thread_templates.length >= 3, definition.id);
      assert.ok(mechanics.beat_library.length >= 2, definition.id);
      assert.ok(mechanics.event_generator.inputs.length >= 5, definition.id);
      assert.ok(mechanics.event_generator.rules.length >= 3, definition.id);
      assert.ok(mechanics.pacing_model.baseline, definition.id);
      assert.ok(mechanics.recovery_model.failure, definition.id);
      assert.ok(mechanics.settlement.authority, definition.id);
      assert.equal(
        mechanics.player_experience_policy.information_budget.no_table_on_entry,
        true,
        definition.id,
      );
      assert.match(
        mechanics.player_experience_policy.principle,
        /先让玩家在意/u,
        definition.id,
      );
      assert.deepEqual(
        Object.keys(mechanics.async_continuity_policy.layers),
        ["trace", "state", "narrative"],
        definition.id,
      );
      assert.match(mechanics.async_continuity_policy.idle, /暂停/u, definition.id);
      assert.match(mechanics.collective_decision_policy.npc_role, /不计作真人/u, definition.id);
      assert.ok(host.judgement_policy.npc_policy.cast.length >= 2, definition.id);
      assert.equal(
        host.judgement_policy.npc_policy.separate_agent_default,
        false,
        definition.id,
      );
      for (const scenario of [
        "zero_players",
        "one_player",
        "few_players",
        "many_players",
        "late_join",
        "returning",
      ]) {
        assert.ok(host.judgement_policy.population_policy[scenario], definition.id);
      }
      assert.match(details.rules_text, new RegExp(`【${definition.name}专属玩法规则】`, "u"));
      assert.match(details.definition_text, /核心循环：/u);
      assert.match(details.definition_text, /长期成长：/u);

      const worldKeys =
        mechanics.state_contract.world_top_level_keys;
      const memberKeys =
        mechanics.state_contract.member_top_level_keys;
      assert.equal(worldKeys[0], "world_progress", definition.id);
      assert.equal(memberKeys[0], "journey", definition.id);
      assert.equal(worldKeys.length, 2, definition.id);
      assert.equal(memberKeys.length, 2, definition.id);
      assert.ok(visitor.worldStateView(definition.id).value[worldKeys[1]], definition.id);
      uniqueWorldStateKeys.add(worldKeys[1]);
      loops.add(mechanics.core_loop);

      const choices = host.onboarding_policy.solo_choices;
      assert.equal(choices.length, 3, definition.id);
      assert.equal(new Set(choices.map((choice) => choice.event_type)).size, 3);
      for (const choice of choices) eventTypes.add(choice.event_type);
    }
    assert.equal(loops.size, OFFICIAL_WORLDS.length);
    assert.equal(uniqueWorldStateKeys.size, OFFICIAL_WORLDS.length);
    assert.equal(eventTypes.size, OFFICIAL_WORLDS.length * 3);
  } finally {
    db.close();
  }
});

test("all five official Host contracts execute one mechanic-specific turn and reject undeclared state", () => {
  const db = openDatabase(":memory:");
  const visitor = new SocialService(db, "official-turn-visitor", {
    platformHostMode: "local_codex",
  });
  visitor.getOrCreatePet({ name: "逐世界行动者" });
  const actorId = visitor.requirePet().id;
  db.exec(`
    ALTER TABLE pets ADD COLUMN display_name TEXT;
    ALTER TABLE pets ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    UPDATE pets SET display_name = name;
  `);
  const executor = new SocialService(db, actorId, {
    identitySchema: "shared",
    principalUserId: "official-turn-visitor",
    principalSessionId: "platform-host-test",
    platformHostExecutor: true,
    platformHostMode: "local_codex",
  });
  try {
    for (const definition of OFFICIAL_WORLDS) {
      visitor.joinWorld({
        worldId: definition.id,
        ruleVersion: OFFICIAL_WORLD_VERSION,
      });
      const entered = visitor.enterWorld({
        worldId: definition.id,
        clientSessionId: `gameplay:${definition.slug}`,
      });
      const choice = entered.host_guidance.choices[0];
      const observed = visitor.observeWorld({ worldId: definition.id });
      const pending = visitor.actInWorld({
        worldId: definition.id,
        inputType: choice.input_type,
        eventType: choice.event_type,
        bodyText: choice.body_text,
        observedWorldStateVersion: observed.world_state.version,
        observedMemberStateVersion: observed.member_state.version,
        idempotencyKey: `gameplay-turn:${definition.slug}`,
        requireLive: true,
      });
      assert.equal(pending.status, "pending", definition.id);

      const work = executor.localCodexHostWork({
        worldId: definition.id,
        inputId: pending.input.id,
      });
      const contract =
        work.host.judgement_policy.world_mechanics.state_contract;
      const worldKey = contract.world_top_level_keys[1];
      const memberKey = contract.member_top_level_keys[1];
      assert.equal(work.input.event_type, choice.event_type, definition.id);
      assert.ok(work.world_state.value[worldKey], definition.id);
      assert.ok(work.actor_member_state.value[memberKey], definition.id);
      assert.equal(work.contract_version, 2, definition.id);
      assert.equal(work.director_plan.contract_version, 2, definition.id);
      assert.equal(
        work.director_plan.family,
        work.host.judgement_policy.world_mechanics.family ?? "general",
        definition.id,
      );
      assert.ok(work.director_plan.selection.beat, definition.id);
      assert.equal(
        work.director_plan.selection.beat.id,
        work.director_plan.selection.thread.beat,
        definition.id,
      );
      assert.ok(work.director_plan.scene_contract.required_hook, definition.id);
      assert.match(
        work.director_plan.continuity_contract.accepted_action_requirement,
        /至少形成/u,
        definition.id,
      );
      assert.match(work.director_plan.continuity_contract.idle, /暂停/u, definition.id);
      assert.match(
        work.director_plan.continuity_contract.collective_decision.npc_role,
        /不计作真人/u,
        definition.id,
      );
      assert.equal(
        work.director_plan.scene_contract.player_facing.information_budget.first_turn_max_choices,
        3,
        definition.id,
      );
      assert.ok(work.director_plan.settlement.authority, definition.id);

      executor.resolveLocalCodexHostInput({
        worldId: definition.id,
        inputId: pending.input.id,
        decision: "accepted",
        reasonText: "行动符合本世界的专属玩法规则。",
        outcomeText: `${definition.host.name}完成了本轮专属玩法结算。`,
        result: { mechanic: definition.slug },
        worldStatePatch: {
          [worldKey]: {
            ...work.world_state.value[worldKey],
            last_tested_action: choice.event_type,
          },
        },
        memberStatePatch: {
          [memberKey]: {
            ...work.actor_member_state.value[memberKey],
            last_tested_action: choice.event_type,
          },
        },
        resolutionDisposition: "apply",
        expectedWorldStateVersion: work.world_state.version,
        expectedMemberStateVersion: work.actor_member_state.version,
      });
      visitor.leaveWorld({ worldId: definition.id });
    }

    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM world_director_turns").get().count,
      OFFICIAL_WORLDS.length,
    );

    assert.throws(
      () =>
        executor.enforceWorldMechanicStateContract({
          worldId: OFFICIAL_WORLDS[0].id,
          worldStatePatch: { cross_world_override: true },
        }),
      (error) => error.code === "WORLD_STATE_CONTRACT_VIOLATION",
    );
  } finally {
    db.close();
  }
});

test("official v6 gameplay state backfills preserve existing World and Character progress", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "official-v2-migration", "旧版居民");
  const worldId = "official-center-town";
  const actorId = visitor.requirePet().id;
  const worldAgentId = `world-agent:${worldId}`;
  try {
    visitor.joinWorld({ worldId, ruleVersion: OFFICIAL_WORLD_VERSION });
    db.prepare(`
      UPDATE world_states
      SET version = version + 1,
        state_json = '{"world_progress":{"phase":"legacy","public_progress":7}}',
        updated_by_world_agent_id = ?
      WHERE space_id = ?
    `).run(worldAgentId, worldId);
    db.prepare(`
      UPDATE world_member_states
      SET version = version + 1,
        state_json = '{"journey":{"stage":"legacy"},"legacy_badge":"founder"}',
        updated_by_world_agent_id = ?
      WHERE space_id = ? AND pet_id = ?
    `).run(worldAgentId, worldId, actorId);

    seedOfficialWorlds(db);
    visitor.joinWorld({ worldId, ruleVersion: OFFICIAL_WORLD_VERSION });

    const worldState = visitor.worldStateView(worldId).value;
    const memberState = visitor.worldMemberStateView(worldId, actorId).value;
    assert.equal(worldState.world_progress.phase, "legacy");
    assert.equal(worldState.world_progress.public_progress, 7);
    assert.ok(worldState.town);
    assert.equal(memberState.journey.stage, "legacy");
    assert.equal(memberState.legacy_badge, "founder");
    assert.ok(memberState.resident);
  } finally {
    db.close();
  }
});

test("official v6 adds grounded world-specific state without changing stable top-level contracts", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "official-v6-state", "新版状态检验者");
  try {
    const expectations = new Map([
      ["official-center-town", ["town", "resident_routines"]],
      ["official-adventurers-guild", ["adventure", "caravan_schedule"]],
      ["official-city-detective-agency", ["mystery", "case_season"]],
      ["official-apocalypse-shelter", ["settlement", "season_phase"]],
      ["official-liminal-backrooms", ["backrooms", "documented_zones"]],
    ]);
    for (const [worldId, [topLevel, groundedField]] of expectations) {
      visitor.joinWorld({ worldId, ruleVersion: OFFICIAL_WORLD_VERSION });
      const state = visitor.worldStateView(worldId).value;
      assert.ok(state[topLevel], worldId);
      assert.ok(state[topLevel][groundedField], worldId);
    }
  } finally {
    db.close();
  }
});

test("urban mystery and backrooms exploration are separate official gameplay families", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "official-mystery-split", "类型检验者");
  try {
    const mystery = visitor.getWorldHost({
      worldId: "official-city-detective-agency",
    }).host;
    const backrooms = visitor.getWorldHost({
      worldId: "official-liminal-backrooms",
    }).host;
    const mysteryMechanics = mystery.judgement_policy.world_mechanics;
    const backroomsMechanics = backrooms.judgement_policy.world_mechanics;
    assert.equal(
      mysteryMechanics.settlement.truth_package.mutable_after_open,
      false,
    );
    assert.deepEqual(
      mysteryMechanics.settlement.evidence_classes,
      ["physical", "testimony", "record", "inference", "red_herring"],
    );
    assert.equal(
      backroomsMechanics.settlement.hidden_rule_policy.mutable_after_first_observation,
      false,
    );
    assert.ok(
      backroomsMechanics.thread_templates.some(
        (thread) => thread.id === "rescue",
      ),
    );
    assert.notEqual(mysteryMechanics.core_loop, backroomsMechanics.core_loop);
  } finally {
    db.close();
  }
});

test("official shortcuts resolve to one exact World", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "shortcut-visitor", "快捷指令体验者");
  try {
    for (const definition of OFFICIAL_WORLDS) {
      const result = visitor.searchWorlds({
        query: definition.shortcut,
        limit: 20,
      });
      assert.equal(result.worlds.length, 1);
      assert.equal(result.worlds[0].id, definition.id);
      assert.equal(result.worlds[0].shortcut, definition.shortcut);
    }
  } finally {
    db.close();
  }
});

test("the center town is useful alone and preserves asynchronous social traces", () => {
  const db = openDatabase(":memory:");
  const first = createCharacter(db, "center-town-first", "先到居民");
  const later = createCharacter(db, "center-town-later", "后来居民");
  const worldId = "official-center-town";
  try {
    for (const visitor of [first, later]) {
      visitor.joinWorld({ worldId, ruleVersion: OFFICIAL_WORLD_VERSION });
    }
    first.enterWorld({ worldId, clientSessionId: "center-town-first-entry" });
    const contribution = first.actInWorld({
      worldId,
      inputType: "action",
      eventType: "world.public_contribution",
      bodyText: "我把车站旁空置的公告栏擦干净，并留下一张欢迎新居民的便签。",
      idempotencyKey: "center-town-welcome-board",
      requireLive: true,
    });
    assert.equal(contribution.status, "accepted");

    const observed = later.observeWorld({ worldId, afterSequence: 0 });
    assert.equal(
      observed.events.some((event) =>
        event.body_text.includes("欢迎新居民的便签"),
      ),
      true,
    );
    assert.equal(observed.host_runtime.active_member_count, 1);
  } finally {
    db.close();
  }
});

test("official Worlds preserve Character agency and private speech", () => {
  const db = openDatabase(":memory:");
  const first = createCharacter(db, "official-agency-first", "住户甲");
  const second = createCharacter(db, "official-agency-second", "住户乙");
  const worldId = "official-center-town";
  try {
    for (const visitor of [first, second]) {
      visitor.joinWorld({ worldId, ruleVersion: OFFICIAL_WORLD_VERSION });
      visitor.enterWorld({
        worldId,
        clientSessionId: `center-town:${visitor.requirePet().id}`,
      });
    }
    const rejected = first.actInWorld({
      worldId,
      inputType: "action",
      eventType: "action",
      bodyText: "我命令住户乙立刻搬出公寓并同意我的决定。",
      idempotencyKey: "shared-apartment-agency-boundary",
      requireLive: true,
    });
    assert.equal(rejected.status, "rejected");

    const privateNote = first.actInWorld({
      worldId,
      inputType: "speech",
      eventType: "speech",
      bodyText: "这是我暂时不想公开的私人想法。",
      visibility: "actor",
      idempotencyKey: "shared-apartment-private-note",
      requireLive: true,
    });
    const observed = second.observeWorld({ worldId, afterSequence: 0 });
    assert.equal(
      observed.events.some((event) => event.id === privateNote.input.id),
      false,
    );
  } finally {
    db.close();
  }
});
