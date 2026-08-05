import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/venue-lab-core/database.js";
import { SocialError } from "../src/venue-lab-core/errors.js";
import { SocialService } from "../src/venue-lab-core/social-service.js";

function createFixture({ resolutionMode = "direct" } = {}) {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "runtime-owner");
  const visitor = new SocialService(db, "runtime-visitor");
  const outsider = new SocialService(db, "runtime-outsider");
  owner.getOrCreatePet({ name: "岛主" });
  visitor.getOrCreatePet({ name: "小蓝" });
  outsider.getOrCreatePet({ name: "路人" });
  const world = owner.createWorld({
    name: "测试荒岛",
    description: "用通用原子能力运行的持久世界。",
    tags: ["测试", "共建"],
    rulesText: "尊重其他成员，只修改世界内状态。",
    definitionText: "宠物可以探索、建造和交换世界内物品。",
    entryPrompt: "先为自己选择一件随身物品。",
    hostPrompt: "根据世界状态说明行动结果，不替宠物做未授权的决定。",
    resolutionMode,
    initialWorldState: { camp: { wood: 1 } },
    initialMemberState: { role: "owner" },
  });
  owner.publishWorld({
    worldId: world.id,
    expectedSpecVersion: 1,
    expectedRuleVersion: 1,
    expectedProfileVersion: 1,
    expectedHostVersion: 1,
  });
  visitor.joinWorld({ worldId: world.id, ruleVersion: 1 });
  return { db, owner, visitor, outsider, worldId: world.id };
}

function expectCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof SocialError && error.code === code,
  );
}

test("world profile, behavior spec, and member rules have independent versions", () => {
  const { db, owner, visitor, worldId } = createFixture();
  try {
    owner.enterWorld({ worldId });
    visitor.enterWorld({ worldId });

    const renamed = owner.updateWorld({
      worldId,
      expectedVersion: 1,
      expectedProfileVersion: 1,
      name: "测试荒岛 2",
    });
    assert.equal(renamed.profile_version, 2);
    assert.equal(renamed.spec_version, 1);
    assert.equal(renamed.rule_version, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM presence").get().count,
      2,
    );

    const evolved = owner.updateWorld({
      worldId,
      expectedVersion: 1,
      definitionText: "岛上开始下雨，宠物仍可自由探索和建造。",
    });
    assert.equal(evolved.spec_version, 2);
    assert.equal(evolved.rule_version, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM presence").get().count,
      2,
    );
    assert.equal(
      visitor.actInWorld({
        worldId,
        eventType: "speak",
        bodyText: "雨好像变大了。",
        idempotencyKey: "version-speak-1",
      }).status,
      "accepted",
    );

    const reruled = owner.updateWorld({
      worldId,
      expectedVersion: 2,
      expectedRuleVersion: 1,
      rulesText: "尊重其他成员；建造前先说明要改变什么。",
    });
    assert.equal(reruled.spec_version, 2);
    assert.equal(reruled.rule_version, 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM presence").get().count,
      0,
    );
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_sessions
          WHERE space_id = ? AND status = 'active'
        `)
        .get(worldId).count,
      0,
    );
    assert.ok(
      db
        .prepare(`
          SELECT last_left_at FROM world_member_journeys
          WHERE space_id = ? AND pet_id = ?
        `)
        .get(worldId, visitor.getProfile().id).last_left_at,
    );
    expectCode(
      () =>
        visitor.actInWorld({
          worldId,
          bodyText: "继续搭帐篷。",
          idempotencyKey: "stale-rules-action",
        }),
      "RULE_VERSION_MISMATCH",
    );
  } finally {
    db.close();
  }
});

test("direct worlds atomically commit intent, outcome, local state, and retry safely", () => {
  const { db, owner, visitor, worldId } = createFixture();
  try {
    assert.throws(
      () =>
        db
          .prepare(`
            UPDATE world_states
            SET version = 2, state_json = '{"bypassed":true}'
            WHERE space_id = ?
          `)
          .run(worldId),
      /WORLD_AGENT_REQUIRED/,
    );
    owner.createWorldTrigger({
      worldId,
      triggerKind: "event",
      eventType: "build",
      instructionText: "营地建造完成后，夜幕降临。",
      payload: { scene: "night" },
    });

    const first = visitor.actInWorld({
      worldId,
      eventType: "build",
      bodyText: "我用木头搭一个挡雨棚。",
      proposedWorldStatePatch: { camp: { wood: 3, shelter: true } },
      proposedMemberStatePatch: { role: "scout", stamina: 8 },
      expectedWorldStateVersion: 1,
      expectedMemberStateVersion: 1,
      idempotencyKey: "build-shelter-1",
    });
    assert.equal(first.status, "accepted");
    assert.equal(first.world_state.version, 2);
    assert.deepEqual(first.world_state.value, {
      camp: { wood: 3, shelter: true },
    });
    assert.deepEqual(first.member_state.value, {
      role: "scout",
      stamina: 8,
    });
    assert.equal(first.input.input_type, "action");
    assert.equal(first.judgement.decision, "accepted");
    assert.equal(first.judgement.decision_source, "automatic");
    const inputRow = db
      .prepare("SELECT * FROM world_inputs WHERE id = ?")
      .get(first.input.id);
    const agentRow = db
      .prepare("SELECT * FROM world_agents WHERE space_id = ?")
      .get(worldId);
    const judgementRow = db
      .prepare("SELECT * FROM world_judgements WHERE input_id = ?")
      .get(first.input.id);
    const worldStateRow = db
      .prepare("SELECT * FROM world_states WHERE space_id = ?")
      .get(worldId);
    assert.equal(inputRow.principal_user_id, "runtime-visitor");
    assert.equal(judgementRow.world_agent_id, agentRow.id);
    assert.equal(worldStateRow.updated_by_pet_id, null);
    assert.equal(worldStateRow.updated_by_world_agent_id, agentRow.id);
    assert.equal(
      db
        .prepare("SELECT actor_type FROM world_events WHERE id = ?")
        .get(judgementRow.outcome_event_id).actor_type,
      "world",
    );

    const retried = visitor.actInWorld({
      worldId,
      eventType: "build",
      bodyText: "我用木头搭一个挡雨棚。",
      proposedWorldStatePatch: { camp: { wood: 99 } },
      expectedWorldStateVersion: 1,
      idempotencyKey: "build-shelter-1",
    });
    assert.equal(retried.world_state.version, 2);
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_events
          WHERE space_id = ? AND event_class = 'intent'
        `)
        .get(worldId).count,
      1,
    );
    expectCode(
      () =>
        visitor.actInWorld({
          worldId,
          eventType: "build",
          bodyText: "我再移动一次营地。",
          proposedWorldStatePatch: { camp: { wood: 4 } },
          expectedWorldStateVersion: 1,
          idempotencyKey: "stale-state-build",
        }),
      "STATE_VERSION_MISMATCH",
    );
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_events
          WHERE space_id = ? AND event_class = 'intent'
        `)
        .get(worldId).count,
      1,
    );

    const firstPage = owner.observeWorld({
      worldId,
      afterSequence: 0,
      limit: 2,
    });
    assert.equal(firstPage.events.length, 2);
    assert.equal(firstPage.has_more, true);
    assert.equal(
      firstPage.cursor,
      firstPage.events[firstPage.events.length - 1].sequence,
    );
    const secondPage = owner.observeWorld({
      worldId,
      afterSequence: firstPage.cursor,
      limit: 100,
    });
    assert.ok(
      secondPage.events.every(
        (event) => event.sequence > firstPage.cursor,
      ),
    );

    const observed = owner.observeWorld({ worldId, afterSequence: 0 });
    assert.ok(observed.events.some((event) => event.event_class === "intent"));
    assert.ok(observed.events.some((event) => event.event_class === "outcome"));
    assert.ok(
      observed.events.some(
        (event) =>
          event.event_type === "trigger.fired" &&
          event.body_text.includes("夜幕降临"),
      ),
    );
    assert.deepEqual(observed.member_state.value, { role: "owner" });

    owner.ackWorldEvents({
      worldId,
      throughSequence: observed.cursor,
    });
    assert.equal(owner.observeWorld({ worldId }).events.length, 0);
    expectCode(
      () => owner.observeWorld({ worldId, afterSequence: 999999 }),
      "INVALID_CURSOR",
    );
  } finally {
    db.close();
  }
});

test("generic Hosts reject actions that clearly violate creator rules", () => {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "rule-owner");
  const visitor = new SocialService(db, "rule-visitor");
  try {
    owner.getOrCreatePet({ name: "集市主人" });
    visitor.getOrCreatePet({ name: "集市访客" });
    const world = owner.createWorld({
      name: "守序集市",
      rulesText: "禁止偷窃；尊重摊主和其他成员。",
      definitionText: "成员可以逛摊、聊天和进行双方同意的交换。",
    });
    owner.publishWorld({
      worldId: world.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    visitor.joinWorld({ worldId: world.id, ruleVersion: 1 });
    const rejected = visitor.actInWorld({
      worldId: world.id,
      inputType: "action",
      eventType: "market.take",
      bodyText: "我趁摊主不注意偷走他的钱袋。",
      idempotencyKey: "market-steal-purse",
    });
    assert.equal(rejected.status, "rejected");
    assert.match(rejected.judgement.reason_text, /禁止偷窃/);
    assert.equal(rejected.world_state.version, 1);
  } finally {
    db.close();
  }
});

test("managed worlds accept actions while the owner is offline and resolve them later", () => {
  const { db, owner, visitor, outsider, worldId } = createFixture({
    resolutionMode: "managed",
  });
  try {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM presence").get().count,
      0,
    );
    const pending = visitor.actInWorld({
      worldId,
      eventType: "explore",
      bodyText: "我沿着海岸寻找淡水。",
      proposedWorldStatePatch: { spring_found: true },
      proposedMemberStatePatch: { role: "explorer" },
      idempotencyKey: "explore-coast-1",
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.input.status, "pending");
    assert.equal(pending.judgement, null);
    assert.equal(pending.world_state.version, 1);
    assert.equal(pending.member_state.version, 1);

    expectCode(
      () =>
        visitor.resolveWorldIntent({
          worldId,
          intentId: pending.intent.id,
          decision: "accepted",
        }),
      "FORBIDDEN",
    );
    expectCode(
      () => outsider.observeWorld({ worldId }),
      "ACTIVE_MEMBERSHIP_REQUIRED",
    );

    const ownerReturn = owner.observeWorld({ worldId });
    assert.equal(ownerReturn.pending_intents.length, 1);
    const resolved = owner.resolveWorldIntent({
      worldId,
      intentId: pending.intent.id,
      decision: "accepted",
      outcomeText: "小蓝在礁石后找到了可饮用的泉水。",
      expectedWorldStateVersion: 1,
      expectedMemberStateVersion: 1,
    });
    assert.equal(resolved.status, "accepted");
    assert.equal(resolved.judgement.decision_source, "creator_review");
    assert.equal(
      resolved.judgement.reviewed_by_pet_id,
      owner.getProfile().id,
    );
    assert.equal(resolved.world_state.value.spring_found, true);
    assert.equal(resolved.member_state.value.role, "explorer");

    const visitorReturn = visitor.observeWorld({ worldId });
    assert.ok(
      visitorReturn.events.some((event) =>
        event.body_text.includes("找到了可饮用的泉水"),
      ),
    );
    assert.equal(visitorReturn.world_state.value.spring_found, true);
  } finally {
    db.close();
  }
});

test("participation pause is self-owned and due triggers advance without the creator present", () => {
  const { db, owner, visitor, worldId } = createFixture();
  try {
    visitor.setWorldDelegation({ worldId, mode: "paused" });
    expectCode(
      () =>
        visitor.actInWorld({
          worldId,
          bodyText: "暂停时不应行动。",
          idempotencyKey: "paused-action",
        }),
      "PARTICIPATION_PAUSED",
    );
    expectCode(
      () => owner.setWorldDelegation({ worldId, mode: "autonomous" }),
      "INVALID_ARGUMENT",
    );
    assert.equal(
      visitor.observeWorld({ worldId }).membership.delegation_mode,
      "paused",
    );
    visitor.setWorldDelegation({ worldId, mode: "manual" });

    owner.createWorldTrigger({
      worldId,
      triggerKind: "at",
      triggerAt: "2020-01-01T00:00:00.000Z",
      instructionText: "潮水退去，沙滩上出现一只上锁的箱子。",
    });
    const observed = visitor.observeWorld({ worldId, afterSequence: 0 });
    assert.ok(
      observed.events.some((event) =>
        event.body_text.includes("上锁的箱子"),
      ),
    );
    assert.equal(
      owner.listWorldTriggers({ worldId, status: "fired" }).triggers.length,
      1,
    );
  } finally {
    db.close();
  }
});
