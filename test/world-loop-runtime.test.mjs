import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/venue-lab-core/database.js";
import { SocialService } from "../src/venue-lab-core/social-service.js";

function fixture() {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "loop-owner");
  const first = new SocialService(db, "loop-first");
  const second = new SocialService(db, "loop-second");
  owner.getOrCreatePet({ name: "循环主持" });
  first.getOrCreatePet({ name: "远山旅人" });
  second.getOrCreatePet({ name: "港口旅人" });
  const world = owner.createWorld({
    name: "循环群岛",
    description: "每个人都有自己的旅程，必要时才发生交汇。",
    tags: ["loop", "测试"],
    rulesText: "每个角色只决定自己的行动；世界事实只由 Host 裁决。",
    definitionText: "群岛共享天气与航线，角色拥有彼此独立的个人目标。",
    entryPrompt: "从你的个人目标继续。",
    resolutionMode: "managed",
    initialWorldState: {
      world_progress: {
        open_threads: [
          {
            id: "public-storm",
            title: "调查群岛上空反常的风暴",
            scope: "world",
          },
        ],
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
  first.joinWorld({ worldId: world.id, ruleVersion: 1 });
  second.joinWorld({ worldId: world.id, ruleVersion: 1 });
  return { db, owner, first, second, worldId: world.id };
}

function setLegacyOpenLoops(db, worldId, petId, titles) {
  const changed = db.prepare(`
    UPDATE world_member_journeys
    SET open_loops_json = ?, updated_at = ?
    WHERE space_id = ? AND pet_id = ?
  `).run(JSON.stringify(titles), new Date().toISOString(), worldId, petId);
  assert.equal(changed.changes, 1);
}

function resolve(owner, worldId, inputId, loopTransition) {
  return owner.resolveWorldIntent({
    worldId,
    intentId: inputId,
    decision: "accepted",
    reasonText: "Host 依据当前世界事实推进角色自己的剧情循环。",
    outcomeText: "这次个人剧情转换已经由 Host 确认。",
    result: {
      resolution: "full_success",
      interpretation: "只改变行动者自己的剧情循环。",
      new_facts: [],
      costs: [],
      opened_hooks: [],
      loop_transition: loopTransition,
    },
  });
}

test("Loop migration is idempotent and gives each unrelated member a private foreground", () => {
  const { db, first, second, worldId } = fixture();
  try {
    const firstId = first.getProfile().id;
    const secondId = second.getProfile().id;
    setLegacyOpenLoops(db, worldId, firstId, ["寻找失踪的观星师"]);
    setLegacyOpenLoops(db, worldId, secondId, ["修复港口的旧灯塔"]);

    const firstEntry = first.enterWorld({
      worldId,
      clientSessionId: "loop-first-session",
    });
    const secondEntry = second.enterWorld({
      worldId,
      clientSessionId: "loop-second-session",
    });

    assert.equal(firstEntry.resume_bundle.resume_kind, "continue");
    assert.equal(
      firstEntry.loop_context.foreground_loop.title,
      "寻找失踪的观星师",
    );
    assert.equal(
      secondEntry.loop_context.foreground_loop.title,
      "修复港口的旧灯塔",
    );
    assert.deepEqual(
      firstEntry.loop_context.public_opportunities.map((loop) => loop.title),
      ["调查群岛上空反常的风暴"],
    );
    assert.equal(
      firstEntry.loop_context.intersection.automatic_presence_intersection,
      false,
    );

    const firstView = JSON.stringify(first.observeWorld({ worldId }));
    const secondView = JSON.stringify(second.observeWorld({ worldId }));
    assert.doesNotMatch(firstView, /修复港口的旧灯塔/u);
    assert.doesNotMatch(secondView, /寻找失踪的观星师/u);
    assert.doesNotMatch(
      JSON.stringify(first.worldHostContextPack(first.requireSpace(worldId), firstId)),
      /修复港口的旧灯塔/u,
    );

    const before = Number(
      db.prepare(`
        SELECT COUNT(*) AS count FROM world_story_loops WHERE space_id = ?
      `).get(worldId).count,
    );
    first.observeWorld({ worldId });
    second.observeWorld({ worldId });
    const after = Number(
      db.prepare(`
        SELECT COUNT(*) AS count FROM world_story_loops WHERE space_id = ?
      `).get(worldId).count,
    );
    assert.equal(after, before);
    assert.equal(
      Number(
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM world_loop_participants participant
          JOIN world_story_loops loop ON loop.id = participant.loop_id
          WHERE participant.pet_id = ? AND loop.owner_pet_id = ?
        `).get(firstId, secondId).count,
      ),
      0,
    );
  } finally {
    db.close();
  }
});

test("only authoritative Host judgements suspend, resume, and complete personal Loops", () => {
  const { db, owner, first, worldId } = fixture();
  try {
    const firstId = first.getProfile().id;
    setLegacyOpenLoops(db, worldId, firstId, ["追踪穿过雪原的白鹿"]);
    const entered = first.enterWorld({
      worldId,
      clientSessionId: "loop-transition-session",
    });
    const originalLoopId = entered.loop_context.foreground_loop.id;

    const pendingSuspend = first.actInWorld({
      worldId,
      eventType: "journey.pause_requested",
      bodyText: "我先把白鹿的线索收好，转去处理眼前的补给。",
      data: {
        // Member text/data is untrusted and cannot directly mutate the Loop.
        loop_transition: { action: "complete", loop_id: originalLoopId },
      },
      idempotencyKey: "loop-suspend",
    });
    assert.equal(pendingSuspend.processing.final, false);
    assert.equal(
      pendingSuspend.loop_context.foreground_loop.id,
      originalLoopId,
    );

    const suspended = resolve(owner, worldId, pendingSuspend.input.id, {
      contract_version: 1,
      loop_id: originalLoopId,
      scope: "personal",
      from_phase: "open",
      transition: "suspend",
      to_phase: "paused_for_supply",
      reason: "行动者主动收起当前线索。",
    });
    assert.ok(
      suspended.loop_context.suspended_loops.some(
        (loop) => loop.id === originalLoopId,
      ),
    );
    assert.equal(
      suspended.loop_context.suspended_loops.find(
        (loop) => loop.id === originalLoopId,
      ).phase,
      "paused_for_supply",
    );
    assert.notEqual(suspended.loop_context.foreground_loop.id, originalLoopId);
    assert.equal(
      suspended.host_response.loop_transition_receipt.applied_transition,
      "suspend",
    );
    assert.equal(
      suspended.judgement.result.loop_transition_receipt.status,
      "applied",
    );

    const pendingResume = first.actInWorld({
      worldId,
      eventType: "journey.resume_requested",
      bodyText: "补给已经备齐，我重新拿出白鹿留下的线索。",
      idempotencyKey: "loop-resume",
    });
    const resumed = resolve(owner, worldId, pendingResume.input.id, {
      contract_version: 1,
      loop_id: originalLoopId,
      scope: "personal",
      from_phase: "paused_for_supply",
      transition: "resume",
      to_phase: "tracking",
      reason: "补给完成后恢复追踪。",
    });
    assert.equal(resumed.loop_context.foreground_loop.id, originalLoopId);
    assert.equal(resumed.loop_context.foreground_loop.status, "active");
    assert.equal(resumed.loop_context.foreground_loop.phase, "tracking");

    const pendingComplete = first.actInWorld({
      worldId,
      eventType: "journey.goal_reached",
      bodyText: "我找到了白鹿守护的山谷，也理解了它留下线索的原因。",
      idempotencyKey: "loop-complete",
    });
    const completed = resolve(owner, worldId, pendingComplete.input.id, {
      contract_version: 1,
      loop_id: originalLoopId,
      scope: "personal",
      from_phase: "tracking",
      transition: "complete",
      to_phase: "resolved",
      reason: "白鹿线索已经结清。",
    });
    assert.ok(
      completed.loop_context.completed_loops.some(
        (loop) => loop.id === originalLoopId,
      ),
    );
    assert.notEqual(completed.loop_context.foreground_loop.id, originalLoopId);
    assert.deepEqual(completed.journey.open_loops, ["追踪穿过雪原的白鹿"]);
    assert.equal(completed.resume_bundle.automatic_context, true);

    const pendingOpen = first.actInWorld({
      worldId,
      eventType: "journey.hook_found",
      bodyText: "山谷里还有一座废弃瞭望塔值得调查。",
      idempotencyKey: "loop-open-v3",
    });
    const opened = owner.resolveWorldIntent({
      worldId,
      intentId: pendingOpen.input.id,
      decision: "accepted",
      reasonText: "Host 确认发现了新的个人剧情钩子。",
      outcomeText: "废弃瞭望塔成为下一段可推进的个人剧情。",
      result: {
        resolution: "full_success",
        interpretation: "打开新的个人 Loop。",
        new_facts: [],
        costs: [],
        opened_hooks: ["调查废弃瞭望塔"],
        loop_transition: {
          contract_version: 1,
          loop_id: "host-proposed-lookout-loop",
          scope: "personal",
          from_phase: "open",
          transition: "open",
          to_phase: "investigating",
          reason: "调查废弃瞭望塔",
          title: "调查废弃瞭望塔",
          foreground: true,
        },
      },
    });
    assert.equal(opened.loop_context.foreground_loop.title, "调查废弃瞭望塔");
    assert.equal(opened.loop_context.foreground_loop.phase, "investigating");
    assert.equal(
      Number(
        db.prepare(`
          SELECT COUNT(*) AS count FROM world_story_loops
          WHERE space_id = ? AND owner_pet_id = ? AND title = ?
        `).get(worldId, firstId, "调查废弃瞭望塔").count,
      ),
      1,
    );
  } finally {
    db.close();
  }
});

test("an invalid v1 Loop transition rolls back the judgement and state atomically", () => {
  const { db, owner, first, worldId } = fixture();
  try {
    const entered = first.enterWorld({
      worldId,
      clientSessionId: "loop-invalid-transition-session",
    });
    const foreground = entered.loop_context.foreground_loop;
    const pending = first.actInWorld({
      worldId,
      eventType: "journey.invalid_transition",
      bodyText: "尝试使用过期的剧情阶段推进世界。",
      proposedWorldStatePatch: { invalid_transition_leaked: true },
      idempotencyKey: "loop-invalid-transition",
    });
    assert.throws(
      () => owner.resolveWorldIntent({
        worldId,
        intentId: pending.input.id,
        decision: "accepted",
        outcomeText: "这个结果不应提交。",
        result: {
          loop_transition: {
            contract_version: 1,
            loop_id: foreground.id,
            scope: "personal",
            from_phase: "stale-phase",
            transition: "continue",
            to_phase: "advanced",
            reason: "故意使用错误阶段。",
          },
        },
        worldStatePatch: { invalid_transition_leaked: true },
        expectedWorldStateVersion: 1,
      }),
      (error) => error.code === "INVALID_LOOP_TRANSITION",
    );
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM world_judgements WHERE input_id = ?
    `).get(pending.input.id).count, 0);
    assert.equal(db.prepare(`
      SELECT status FROM world_inputs WHERE id = ?
    `).get(pending.input.id).status, "pending");
    assert.equal(first.observeWorld({ worldId }).world_state.version, 1);
    assert.equal(
      first.observeWorld({ worldId }).world_state.value.invalid_transition_leaked,
      undefined,
    );
    assert.equal(
      first.observeWorld({ worldId }).loop_context.foreground_loop.phase,
      foreground.phase,
    );
  } finally {
    db.close();
  }
});

test("Builder validation continues to accept persisted compiler v2 packages", () => {
  const db = openDatabase(":memory:");
  try {
    const service = new SocialService(db, "loop-builder-reader");
    const row = db.prepare(`
      SELECT artifact_json FROM world_build_sessions
      WHERE world_id = 'official-center-town'
    `).get();
    const artifact = JSON.parse(row.artifact_json);
    artifact.worldPackage.compiler_version = 2;
    const validation = service.validateWorldBuildArtifact(artifact);
    assert.equal(
      validation.experience_checks.find(
        (check) => check.id === "compiled_world_package",
      )?.status,
      "pass",
    );
  } finally {
    db.close();
  }
});
