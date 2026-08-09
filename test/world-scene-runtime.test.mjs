import assert from "node:assert/strict";
import test from "node:test";

import {
  migrateWorldRuntime,
  openDatabase,
} from "../src/venue-lab-core/database.js";
import { SocialError } from "../src/venue-lab-core/errors.js";
import { SocialService } from "../src/venue-lab-core/social-service.js";

function expectCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof SocialError && error.code === code,
  );
}

function fixture() {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "scene-owner");
  const a = new SocialService(db, "scene-a");
  const b = new SocialService(db, "scene-b");
  const c = new SocialService(db, "scene-c");
  const d = new SocialService(db, "scene-d");
  owner.getOrCreatePet({ name: "场景主持" });
  a.getOrCreatePet({ name: "甲" });
  b.getOrCreatePet({ name: "乙" });
  c.getOrCreatePet({ name: "丙" });
  d.getOrCreatePet({ name: "丁" });
  const world = owner.createWorld({
    name: "交汇群岛",
    description: "每个人都有独立剧情，只有明确因果交叉才形成多人场景。",
    tags: ["scene", "测试"],
    rulesText: "每个角色只决定自己的行动，交汇必须有明确因果依据。",
    definitionText: "每个角色拥有各自的前台剧情，只有因果交叉才形成场景。",
    entryPrompt: "从自己的个人目标继续；其他角色在线不会自动形成同场。",
    resolutionMode: "managed",
    initialWorldState: {
      world_progress: {
        phase: "open",
        public_progress: [],
        open_threads: [],
        recent_changes: [],
        next_event_seeds: [],
      },
    },
    initialMemberState: {
      journey: {
        stage: "new",
        completed_actions: [],
        discoveries: [],
        open_goals: [],
        last_thread_id: null,
      },
    },
  });
  owner.publishWorld({
    worldId: world.id,
    expectedSpecVersion: 1,
    expectedRuleVersion: 1,
    expectedProfileVersion: 1,
    expectedHostVersion: 1,
  });
  for (const member of [a, b, c, d]) {
    member.joinWorld({ worldId: world.id, ruleVersion: 1 });
    member.enterWorld({
      worldId: world.id,
      clientSessionId: `session-${member.getProfile().id}`,
    });
  }
  owner.enterWorld({ worldId: world.id, clientSessionId: "scene-host-session" });
  owner.takeoverWorldHost({
    worldId: world.id,
    clientSessionId: "scene-host-session",
  });
  return { db, owner, a, b, c, d, worldId: world.id };
}

function directSpeech(service, worldId, targetId, key) {
  return service.actInWorld({
    worldId,
    inputType: "speech",
    eventType: "speech.directed",
    bodyText: `我向 ${targetId} 发起一次有明确对象的交涉。`,
    data: { target_character_id: targetId },
    visibility: "world",
    idempotencyKey: key,
  });
}

test("Scene migration is idempotent and preserves legacy/scene interaction uniqueness", () => {
  const db = openDatabase(":memory:");
  try {
    migrateWorldRuntime(db);
    migrateWorldRuntime(db);
    const tables = new Set(
      db.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table'
          AND name IN ('world_scenes', 'world_scene_participants')
      `).all().map((row) => row.name),
    );
    assert.deepEqual(
      tables,
      new Set(["world_scenes", "world_scene_participants"]),
    );
    const columns = db.prepare("PRAGMA table_info(world_interactions)").all();
    assert.ok(columns.some((column) => column.name === "scene_id"));
    const indexes = new Set(
      db.prepare("PRAGMA index_list(world_interactions)").all()
        .map((index) => index.name),
    );
    assert.ok(indexes.has("idx_world_interaction_active_legacy"));
    assert.ok(indexes.has("idx_world_interaction_active_scene"));
  } finally {
    db.close();
  }
});

test("directed A/B causal intersection binds private foreground Loops and isolates C", () => {
  const { db, owner, a, b, c, d, worldId } = fixture();
  try {
    const aId = a.getProfile().id;
    const bId = b.getProfile().id;
    const cId = c.getProfile().id;
    const dId = d.getProfile().id;
    db.prepare(`
      UPDATE world_member_journeys
      SET current_role = ?, participation_intent = ?, updated_at = ?
      WHERE space_id = ? AND pet_id = ?
    `).run(
      "乙的秘密身份-不可泄露",
      "乙的秘密目标-不可泄露",
      new Date().toISOString(),
      worldId,
      bId,
    );
    const bLoopId = b.worldLoopContext(worldId, bId).foreground_loop.id;
    db.prepare(`
      UPDATE world_loop_participants SET private_context_json = ?
      WHERE loop_id = ? AND pet_id = ?
    `).run(JSON.stringify({ secret: "乙的私人 Loop 线索-不可泄露" }), bLoopId, bId);

    const pending = directSpeech(a, worldId, bId, "scene-a-to-b");
    const scene = db.prepare(`
      SELECT * FROM world_scenes WHERE source_input_id = ?
    `).get(pending.input.id);
    assert.equal(scene.status, "active");
    assert.equal(scene.interaction_policy, "flexible");
    const participants = db.prepare(`
      SELECT pet_id, personal_loop_id FROM world_scene_participants
      WHERE scene_id = ? ORDER BY pet_id
    `).all(scene.id);
    assert.deepEqual(
      participants.map((row) => row.pet_id),
      [aId, bId].sort(),
    );
    assert.ok(participants.every((row) => row.personal_loop_id));

    const aLoopId = participants.find((row) => row.pet_id === aId).personal_loop_id;
    owner.resolveWorldIntent({
      worldId,
      intentId: pending.input.id,
      decision: "accepted",
      outcomeText: "甲与乙的因果交汇已经由 Host 确认。",
      result: {
        loop_transition: {
          contract_version: 1,
          transition: "intersect",
          loop_id: aLoopId,
          scope: "personal",
          from_phase: "open",
          to_phase: "open",
          reason: "两个个人剧情因明确对话发生交汇。",
          target_loop_id: bLoopId,
          target_character_id: bId,
          scene_policy: "flexible",
        },
      },
      expectedWorldStateVersion: 1,
    });
    const edge = db.prepare(`
      SELECT status, contract_json FROM world_loop_edges
      WHERE source_loop_id IN (?, ?) AND target_loop_id IN (?, ?)
    `).get(aLoopId, bLoopId, aLoopId, bLoopId);
    assert.equal(edge.status, "active");
    assert.equal(JSON.parse(edge.contract_json).scene_id, scene.id);

    const cView = JSON.stringify(c.observeWorld({ worldId, afterSequence: 0 }));
    assert.doesNotMatch(cView, /发起一次有明确对象的交涉/u);
    const cReturn = c.enterWorld({
      worldId,
      clientSessionId: "scene-c-cursor-roundtrip",
    });
    const cAfterReturn = c.observeWorld({
      worldId,
      afterSequence: cReturn.last_event_sequence,
    });
    assert.equal(cAfterReturn.cursor, cReturn.last_event_sequence);
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count FROM world_scene_participants
        WHERE scene_id = ? AND pet_id = ?
      `).get(scene.id, cId).count,
      0,
    );
    const hostContext = JSON.stringify(
      a.worldHostContextPack(a.requireSpace(worldId), aId),
    );
    assert.doesNotMatch(hostContext, /乙的秘密身份-不可泄露/u);
    assert.doesNotMatch(hostContext, /乙的秘密目标-不可泄露/u);
    assert.doesNotMatch(hostContext, /乙的私人 Loop 线索-不可泄露/u);
    const liveB = a.worldHostContextPack(a.requireSpace(worldId), aId)
      .live_members.find((member) => member.pet_id === bId);
    assert.deepEqual(Object.keys(liveB).sort(), ["name", "pet_id", "present_since"]);

    const privateThought = b.actInWorld({
      worldId,
      eventType: "private.thought",
      bodyText: "B SECRET BODY：这只是乙自己的内心想法。",
      visibility: "actor",
      idempotencyKey: "scene-private-thought",
    });
    const privateResult = owner.resolveWorldIntent({
      worldId,
      intentId: privateThought.input.id,
      decision: "accepted",
      outcomeText: "B SECRET OUTCOME：乙在心里确认了自己的秘密。",
      result: {
        affected_entities: [
          { entity_type: "character", entity_id: aId },
        ],
      },
      expectedWorldStateVersion: 1,
    });
    assert.equal(privateResult.intent.scene_id, null);
    assert.equal(privateResult.outcome.scene_id, null);
    const aAfterPrivate = JSON.stringify(
      a.worldHostContextPack(a.requireSpace(worldId), aId),
    );
    assert.doesNotMatch(aAfterPrivate, /B SECRET BODY|B SECRET OUTCOME/u);
    assert.doesNotMatch(
      a.worldContextSummary(worldId, { petId: aId, maxEvents: 8 }),
      /B SECRET BODY|B SECRET OUTCOME/u,
    );
    assert.match(
      JSON.stringify(b.worldHostContextPack(b.requireSpace(worldId), bId)),
      /B SECRET BODY|B SECRET OUTCOME/u,
    );

    const sharedAction = a.actInWorld({
      worldId,
      sceneId: scene.id,
      eventType: "scene.shared_action",
      bodyText: "甲明确在与乙的 Scene 中推进共同处境。",
      visibility: "world",
      idempotencyKey: "scene-explicit-binding",
    });
    const sharedResult = owner.resolveWorldIntent({
      worldId,
      intentId: sharedAction.input.id,
      decision: "accepted",
      outcomeText: "甲乙所在的 Scene 因这次行动发生变化。",
      result: {
        affected_entities: [
          { entity_type: "character", entity_id: bId },
        ],
      },
      expectedWorldStateVersion: 1,
    });
    assert.equal(sharedResult.intent.scene_id, scene.id);
    assert.equal(sharedResult.outcome.scene_id, scene.id);
    expectCode(
      () => c.actInWorld({
        worldId,
        sceneId: scene.id,
        eventType: "scene.outsider_attempt",
        bodyText: "丙试图把自己的行动塞进甲乙 Scene。",
        visibility: "world",
        idempotencyKey: "scene-outsider-binding",
      }),
      "WORLD_SCENE_PARTICIPANT_REQUIRED",
    );

    const unrelated = c.actInWorld({
      worldId,
      eventType: "explore.unrelated",
      bodyText: "丙继续自己的路线。",
      idempotencyKey: "host-cannot-invent-affected-d",
    });
    owner.resolveWorldIntent({
      worldId,
      intentId: unrelated.input.id,
      decision: "accepted",
      outcomeText: "丙的个人路线继续。",
      result: {
        affected_entities: [
          { entity_type: "character", entity_id: dId },
        ],
      },
      expectedWorldStateVersion: 1,
    });
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count FROM world_scenes WHERE source_input_id = ?
      `).get(unrelated.input.id).count,
      0,
    );
    const dStateBefore = d.worldMemberStateView(worldId, dId);
    const hijackAttempt = c.actInWorld({
      worldId,
      eventType: "unrelated.hijack_attempt",
      bodyText: "丙继续一件与丁无关的事。",
      idempotencyKey: "cross-character-state-rejected",
    });
    expectCode(
      () => owner.resolveWorldIntent({
        worldId,
        intentId: hijackAttempt.input.id,
        decision: "accepted",
        outcomeText: "不得借丙的行动改写丁。",
        memberStatePatch: { hijacked_by_unrelated: true },
        targetPetId: dId,
        expectedWorldStateVersion: 1,
        expectedMemberStateVersion: dStateBefore.version,
      }),
      "CROSS_CHARACTER_STATE_FORBIDDEN",
    );
    assert.equal(
      d.worldMemberStateView(worldId, dId).version,
      dStateBefore.version,
    );
    assert.equal(
      d.worldMemberStateView(worldId, dId).value.hijacked_by_unrelated,
      undefined,
    );
    const aPerspective = a.worldHostContextPack(a.requireSpace(worldId), aId);
    const bPerspective = b.worldHostContextPack(b.requireSpace(worldId), bId);
    const cPerspective = c.worldHostContextPack(c.requireSpace(worldId), cId);
    assert.doesNotMatch(
      JSON.stringify(aPerspective.recent_events),
      /丙的个人路线继续/u,
    );
    assert.match(
      JSON.stringify(cPerspective.recent_events),
      /丙的个人路线继续/u,
    );
    assert.match(
      JSON.stringify(bPerspective.recent_events),
      /甲与乙的因果交汇已经由 Host 确认/u,
    );
    assert.doesNotMatch(
      a.worldContextSummary(worldId, { petId: aId, maxEvents: 8 }),
      /丙的个人路线继续/u,
    );

    owner.insertWorldEvent({
      spaceId: worldId,
      actorType: "system",
      eventClass: "outcome",
      eventType: "world.weather_changed",
      bodyText: "整座群岛开始下雨。",
      visibility: "world",
      specVersion: 1,
    });
    assert.match(
      JSON.stringify(
        a.worldHostContextPack(a.requireSpace(worldId), aId).recent_events,
      ),
      /整座群岛开始下雨/u,
    );
  } finally {
    db.close();
  }
});

test("different Scenes run collective windows in parallel and reject outsiders", () => {
  const { db, owner, a, b, c, d, worldId } = fixture();
  try {
    const abInput = directSpeech(a, worldId, b.getProfile().id, "parallel-ab");
    const cdInput = directSpeech(c, worldId, d.getProfile().id, "parallel-cd");
    const abScene = db.prepare(
      "SELECT id FROM world_scenes WHERE source_input_id = ?",
    ).get(abInput.input.id).id;
    const cdScene = db.prepare(
      "SELECT id FROM world_scenes WHERE source_input_id = ?",
    ).get(cdInput.input.id).id;
    assert.notEqual(abScene, cdScene);
    owner.resolveWorldIntent({
      worldId,
      intentId: abInput.input.id,
      decision: "accepted",
      outcomeText: "甲乙采用异步方式继续。",
      result: { scene_policy: "async" },
      expectedWorldStateVersion: 1,
    });
    owner.resolveWorldIntent({
      worldId,
      intentId: cdInput.input.id,
      decision: "accepted",
      outcomeText: "丙丁采用同步方式继续。",
      result: { scene_policy: "sync" },
      expectedWorldStateVersion: 1,
    });
    assert.equal(
      db.prepare("SELECT interaction_policy FROM world_scenes WHERE id = ?")
        .get(abScene).interaction_policy,
      "async",
    );
    assert.equal(
      db.prepare("SELECT interaction_policy FROM world_scenes WHERE id = ?")
        .get(cdScene).interaction_policy,
      "sync",
    );

    const ab = owner.openWorldHostInteraction({
      worldId,
      clientSessionId: "scene-host-session",
      sceneId: abScene,
      promptText: "甲乙如何共同处理眼前的交汇？",
      mode: "windowed",
      windowSeconds: 3_600,
      expectedWorldStateVersion: 1,
    });
    const cd = owner.openWorldHostInteraction({
      worldId,
      clientSessionId: "scene-host-session",
      sceneId: cdScene,
      promptText: "丙丁如何共同处理眼前的交汇？",
      mode: "windowed",
      windowSeconds: 60,
      expectedWorldStateVersion: 1,
    });
    assert.equal(ab.interaction.scene_id, abScene);
    assert.equal(cd.interaction.scene_id, cdScene);
    b.leaveWorld({ worldId });
    const asyncOffline = b.actInWorld({
      worldId,
      sceneId: abScene,
      eventType: "scene.async_follow_up",
      bodyText: "乙离线后仍可在异步 Scene 留下后续。",
      idempotencyKey: "scene-async-offline",
    });
    assert.equal(asyncOffline.status, "pending");
    d.leaveWorld({ worldId });
    expectCode(
      () => d.actInWorld({
        worldId,
        sceneId: cdScene,
        eventType: "scene.sync_offline_attempt",
        bodyText: "丁离开实时会话后不能继续同步 Scene。",
        idempotencyKey: "scene-sync-offline",
      }),
      "WORLD_NOT_ENTERED",
    );
    assert.equal(
      db.prepare(`
        SELECT COUNT(*) AS count FROM world_interactions
        WHERE space_id = ? AND status = 'open'
      `).get(worldId).count,
      2,
    );
    expectCode(
      () => owner.openWorldHostInteraction({
        worldId,
        clientSessionId: "scene-host-session",
        sceneId: abScene,
        promptText: "同一场景不能再开第二个窗口。",
        mode: "windowed",
        windowSeconds: 60,
        expectedWorldStateVersion: 1,
      }),
      "WORLD_INTERACTION_ACTIVE",
    );
    expectCode(
      () => c.actInWorld({
        worldId,
        inputType: "choice",
        eventType: "collective.response",
        bodyText: "丙试图回应甲乙的场景。",
        replyToEventId: ab.prompt_event.id,
        idempotencyKey: "outsider-ab-response",
      }),
      "NOT_FOUND",
    );
    assert.deepEqual(
      a.activeWorldInteractions(worldId, a.getProfile().id).map((item) => item.id),
      [ab.interaction.id],
    );
    assert.deepEqual(
      c.activeWorldInteractions(worldId, c.getProfile().id).map((item) => item.id),
      [cd.interaction.id],
    );
  } finally {
    db.close();
  }
});

test("explicit Scene and reply binding cannot be guessed across concurrent encounters", () => {
  const { db, a, b, c, worldId } = fixture();
  try {
    const ab = directSpeech(a, worldId, b.getProfile().id, "binding-ab");
    const ac = directSpeech(a, worldId, c.getProfile().id, "binding-ac");
    const abScene = db.prepare(
      "SELECT id FROM world_scenes WHERE source_input_id = ?",
    ).get(ab.input.id).id;
    const acScene = db.prepare(
      "SELECT id FROM world_scenes WHERE source_input_id = ?",
    ).get(ac.input.id).id;
    assert.notEqual(abScene, acScene);
    expectCode(() => a.actInWorld({
      worldId,
      sceneId: abScene,
      replyToEventId: ac.intent.id,
      eventType: "scene.reply",
      bodyText: "不能把对丙的回应错绑到甲乙场景。",
      idempotencyKey: "binding-wrong-reply",
    }), "WORLD_SCENE_REPLY_MISMATCH");
    expectCode(() => a.actInWorld({
      worldId,
      sceneId: abScene,
      inputType: "speech",
      eventType: "speech.directed",
      bodyText: "不能在甲乙场景里把丙作为定向目标。",
      data: { target_character_id: c.getProfile().id },
      idempotencyKey: "binding-outsider-target",
    }), "WORLD_SCENE_TARGET_MISMATCH");
  } finally {
    db.close();
  }
});

test("Scene lifecycle advances monotonically through resolved and closed", () => {
  const { db, owner, a, b, worldId } = fixture();
  try {
    const first = directSpeech(a, worldId, b.getProfile().id, "lifecycle-open");
    const sceneId = db.prepare(
      "SELECT id FROM world_scenes WHERE source_input_id = ?",
    ).get(first.input.id).id;
    owner.resolveWorldIntent({
      worldId,
      intentId: first.input.id,
      decision: "accepted",
      outcomeText: "场景中的核心分歧已经解决。",
      result: {
        scene_transition: { scene_id: sceneId, to_status: "resolved" },
      },
      expectedWorldStateVersion: 1,
    });
    assert.equal(
      db.prepare("SELECT status FROM world_scenes WHERE id = ?").get(sceneId).status,
      "resolved",
    );

    const invalidReopen = a.actInWorld({
      worldId,
      sceneId,
      eventType: "scene.invalid_reopen",
      bodyText: "甲试图把已解决场景倒退回 active。",
      idempotencyKey: "lifecycle-invalid-reopen",
    });
    expectCode(
      () => owner.resolveWorldIntent({
        worldId,
        intentId: invalidReopen.input.id,
        decision: "accepted",
        outcomeText: "这项倒退不应提交。",
        result: {
          scene_transition: { scene_id: sceneId, to_status: "active" },
        },
        expectedWorldStateVersion: 1,
      }),
      "INVALID_SCENE_TRANSITION",
    );
    assert.equal(
      db.prepare("SELECT status FROM world_scenes WHERE id = ?").get(sceneId).status,
      "resolved",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM world_judgements WHERE input_id = ?")
        .get(invalidReopen.input.id).count,
      0,
    );

    // A resolved Scene remains available for one final epilogue transition.
    const closing = a.actInWorld({
      worldId,
      sceneId,
      eventType: "scene.epilogue",
      bodyText: "甲为这次交汇收尾。",
      idempotencyKey: "lifecycle-close",
    });
    owner.resolveWorldIntent({
      worldId,
      intentId: closing.input.id,
      decision: "accepted",
      outcomeText: "这次交汇正式结束。",
      result: {
        scene_transition: { scene_id: sceneId, to_status: "closed" },
      },
      expectedWorldStateVersion: 1,
    });
    const closed = db.prepare(
      "SELECT status, resolved_at, closed_at FROM world_scenes WHERE id = ?",
    ).get(sceneId);
    assert.equal(closed.status, "closed");
    assert.ok(closed.resolved_at);
    assert.ok(closed.closed_at);
  } finally {
    db.close();
  }
});
