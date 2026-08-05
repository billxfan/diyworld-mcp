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

test("the platform publishes 20 distinct solo-first official Worlds", () => {
  const db = openDatabase(":memory:");
  const visitor = createCharacter(db, "official-catalog-visitor", "目录体验者");
  try {
    const catalog = visitor.searchWorlds({ limit: 50 }).worlds;
    assert.equal(catalog.length, 20);
    assert.deepEqual(
      catalog.map((world) => world.id),
      OFFICIAL_WORLDS.map((world) => world.id),
    );
    assert.equal(new Set(catalog.map((world) => world.category)).size, 6);
    assert.equal(new Set(catalog.map((world) => world.shortcut)).size, 20);

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
      assert.match(entered.host_guidance.message, /没有其他真人在线也可以完整参与/);
      assert.ok(
        ["action", "choice", "speech"].includes(
          entered.host_guidance.choices[0].input_type,
        ),
      );
      assert.equal(entered.host_guidance.choices.length, 3);
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
      assert.equal(mechanics.host_directives.length, 2, definition.id);
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

test("all 20 official Host contracts execute one mechanic-specific turn and reject undeclared state", () => {
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

test("official v2 gameplay state backfills preserve existing World and Character progress", () => {
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
  const worldId = "official-shared-apartment";
  try {
    for (const visitor of [first, second]) {
      visitor.joinWorld({ worldId, ruleVersion: OFFICIAL_WORLD_VERSION });
      visitor.enterWorld({
        worldId,
        clientSessionId: `shared-apartment:${visitor.requirePet().id}`,
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
