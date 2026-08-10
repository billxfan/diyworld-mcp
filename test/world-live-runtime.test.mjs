import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";
import { SocialError } from "../src/venue-lab-core/errors.js";
import { openDatabase } from "../src/venue-lab-core/database.js";
import { SocialService } from "../src/venue-lab-core/social-service.js";
import { callWorldTool, worldTools } from "../src/world-tools.mjs";

function expectCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof SocialError && error.code === code,
  );
}

function createLiveFixture() {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "live-owner");
  const visitor = new SocialService(db, "live-visitor");
  const outsider = new SocialService(db, "live-outsider");
  owner.getOrCreatePet({ name: "世界创建者" });
  visitor.getOrCreatePet({ name: "实时访客" });
  outsider.getOrCreatePet({ name: "旁观者" });
  const world = owner.createWorld({
    name: "持续旅馆",
    rulesText: "不替其他成员发言，所有行动交给主持结算。",
    definitionText: "宠物共同经营一间会持续变化的旅馆。",
    resolutionMode: "direct",
    initialWorldState: { reputation: 1 },
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

test("a World activates on entry, sleeps after exit, and requires live presence", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  try {
    const idle = owner.getWorldHostRuntime({ worldId }).runtime;
    assert.equal(idle.status, "idle");
    assert.equal(idle.availability, "on_demand");
    assert.equal(idle.active_executor, "platform");

    expectCode(
      () =>
        visitor.actInWorld({
          worldId,
          bodyText: "我还没有进入世界。",
          idempotencyKey: "not-entered",
          requireLive: true,
        }),
      "WORLD_NOT_ENTERED",
    );

    const ownerEntry = owner.enterWorld({
      worldId,
      clientSessionId: "owner-live-session",
    });
    assert.equal(ownerEntry.host_runtime.status, "active");
    assert.equal(ownerEntry.host_runtime.active_member_count, 1);
    assert.equal(ownerEntry.host_runtime.activation_count, 1);

    const visitorEntry = visitor.enterWorld({
      worldId,
      clientSessionId: "visitor-live-session",
    });
    assert.equal(visitorEntry.host_runtime.active_member_count, 2);

    visitor.leaveWorld({ worldId });
    assert.equal(
      owner.getWorldHostRuntime({ worldId }).runtime.active_member_count,
      1,
    );
    const left = owner.leaveWorld({ worldId });
    assert.equal(left.host_runtime.status, "idle");
    assert.equal(left.host_runtime.active_executor, "platform");
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_sessions WHERE status = 'active'
        `)
        .get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test("re-entering is idempotent and cross-World movement records departure", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  try {
    visitor.enterWorld({
      worldId,
      clientSessionId: "idempotent-entry-one",
    });
    const firstEnteredAt = db
      .prepare("SELECT entered_at FROM presence WHERE pet_id = ?")
      .get(visitor.getProfile().id).entered_at;
    const repeated = visitor.enterWorld({
      worldId,
      clientSessionId: "idempotent-entry-two",
    });
    assert.equal(repeated.moved_from_world_id, null);
    assert.equal(
      db
        .prepare(`
          SELECT visit_count FROM world_member_journeys
          WHERE space_id = ? AND pet_id = ?
        `)
        .get(worldId, visitor.getProfile().id).visit_count,
      1,
    );
    assert.equal(
      db
        .prepare("SELECT entered_at FROM presence WHERE pet_id = ?")
        .get(visitor.getProfile().id).entered_at,
      firstEnteredAt,
    );

    const nextWorld = owner.createWorld({
      name: "第二座持续旅馆",
      rulesText: "尊重成员，只决定自己的行动。",
      definitionText: "另一间用于验证跨世界移动的持久旅馆。",
    });
    owner.publishWorld({
      worldId: nextWorld.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    visitor.joinWorld({ worldId: nextWorld.id, ruleVersion: 1 });
    const moved = visitor.enterWorld({
      worldId: nextWorld.id,
      clientSessionId: "cross-world-entry",
    });
    assert.equal(moved.moved_from_world_id, worldId);
    const departure = db
      .prepare(`
        SELECT last_left_at, last_departure_sequence
        FROM world_member_journeys
        WHERE space_id = ? AND pet_id = ?
      `)
      .get(worldId, visitor.getProfile().id);
    assert.ok(departure.last_left_at);
    assert.ok(departure.last_departure_sequence > 0);
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_sessions
          WHERE space_id = ? AND pet_id = ? AND status = 'active'
        `)
        .get(worldId, visitor.getProfile().id).count,
      0,
    );
  } finally {
    db.close();
  }
});

test("a creator Codex can take over the Host and platform resumes after release", () => {
  const { db, owner, visitor, outsider, worldId } = createLiveFixture();
  try {
    owner.enterWorld({ worldId, clientSessionId: "owner-host-session" });
    visitor.enterWorld({ worldId, clientSessionId: "visitor-session" });

    expectCode(
      () =>
        outsider.takeoverWorldHost({
          worldId,
          clientSessionId: "outsider-session",
        }),
      "FORBIDDEN",
    );

    const claimed = owner.takeoverWorldHost({
      worldId,
      clientSessionId: "owner-host-session",
      leaseSeconds: 90,
    }).runtime;
    assert.equal(claimed.active_executor, "creator_codex");
    assert.equal(claimed.engine, "creator_codex");
    assert.equal(claimed.judgement_contract_version, 2);
    assert.equal(claimed.is_current_executor, true);

    const pending = visitor.actInWorld({
      worldId,
      eventType: "repair",
      bodyText: "我修好了漏雨的阁楼。",
      proposedWorldStatePatch: { atticRepaired: true },
      expectedWorldStateVersion: 1,
      idempotencyKey: "creator-host-repair",
      requireLive: true,
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.outcome, null);

    const next = owner.nextWorldHostInput({
      worldId,
      clientSessionId: "owner-host-session",
    });
    assert.equal(next.input.id, pending.input.id);
    assert.equal(next.input.body_text, "我修好了漏雨的阁楼。");
    assert.deepEqual(next.input.proposed_world_state_patch, {
      atticRepaired: true,
    });
    assert.equal(next.context.contract_version, 2);
    assert.equal(next.context.live_members.length, 2);
    assert.equal(next.context.actor_journey.pet_id, next.actor.id);
    assert.ok(
      next.context.recent_events.some(
        (event) => event.id === pending.input.id,
      ),
    );

    const resolved = owner.resolveWorldHostInput({
      worldId,
      inputId: pending.input.id,
      clientSessionId: "owner-host-session",
      decision: "accepted",
      reasonText: "修理行动与当前世界规则一致。",
      outcomeText: "阁楼不再漏雨，旅馆声望提升了。",
      result: {
        resolution: "partial_success",
        interpretation: "访客修好了漏雨点，但消耗了一批木料。",
        new_facts: ["阁楼不再漏雨。"],
        costs: ["消耗一批木料"],
        opened_hooks: ["需要补充新的木料库存。"],
      },
      expectedWorldStateVersion: 1,
      applyProposedState: true,
    });
    assert.equal(resolved.status, "accepted");
    assert.equal(resolved.host_response.resolution, "partial_success");
    assert.deepEqual(resolved.host_response.costs, ["消耗一批木料"]);
    assert.equal(resolved.world_state.value.atticRepaired, true);
    assert.equal(resolved.host_runtime.active_executor, "creator_codex");

    const privatePending = visitor.actInWorld({
      worldId,
      eventType: "private.repair",
      bodyText: "这是只对我可见的行动，不应改写公共世界。",
      proposedWorldStatePatch: { privateActionBecamePublic: true },
      expectedWorldStateVersion: 2,
      visibility: "actor",
      idempotencyKey: "creator-host-private-repair",
      requireLive: true,
    });
    assert.equal(privatePending.status, "pending");
    expectCode(
      () =>
        owner.resolveWorldHostInput({
          worldId,
          inputId: privatePending.input.id,
          clientSessionId: "owner-host-session",
          decision: "accepted",
          outcomeText: "这项私密行动不能成为公共事实。",
          expectedWorldStateVersion: 2,
          applyProposedState: true,
        }),
      "INVALID_ARGUMENT",
    );
    assert.equal(
      visitor.observeWorld({ worldId }).world_state.value
        .privateActionBecamePublic,
      undefined,
    );
    owner.resolveWorldHostInput({
      worldId,
      inputId: privatePending.input.id,
      clientSessionId: "owner-host-session",
      decision: "clarification",
      outcomeText: "如需改变公共世界，请公开提交相关行动。",
      expectedWorldStateVersion: 2,
      applyProposedState: false,
    });

    const released = owner.releaseWorldHost({
      worldId,
      clientSessionId: "owner-host-session",
    }).runtime;
    assert.equal(released.active_executor, "platform");
    assert.equal(released.engine, "platform_policy_v1");
    assert.equal(released.model_backed, false);

    const automatic = visitor.actInWorld({
      worldId,
      eventType: "speech",
      inputType: "speech",
      bodyText: "今晚可以正常接待住客了。",
      idempotencyKey: "platform-resumed",
      requireLive: true,
    });
    assert.equal(automatic.status, "accepted");
    assert.equal(automatic.judgement.decision_source, "automatic");
  } finally {
    db.close();
  }
});

test("an expired creator Host lease falls back to the platform", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  try {
    owner.enterWorld({ worldId, clientSessionId: "expiring-host-session" });
    visitor.enterWorld({ worldId, clientSessionId: "visitor-session" });
    owner.takeoverWorldHost({
      worldId,
      clientSessionId: "expiring-host-session",
    });
    db.prepare(`
      UPDATE world_host_runtimes
      SET lease_expires_at = '2000-01-01T00:00:00.000Z'
      WHERE space_id = ?
    `).run(worldId);

    const fallback = owner.getWorldHostRuntime({ worldId }).runtime;
    assert.equal(fallback.status, "active");
    assert.equal(fallback.active_executor, "platform");
    assert.equal(fallback.claimed_by_pet_id, null);
    expectCode(
      () =>
        owner.heartbeatWorldHost({
          worldId,
          clientSessionId: "expiring-host-session",
        }),
      "WORLD_HOST_CLAIM_REQUIRED",
    );
  } finally {
    db.close();
  }
});

test("the Host detects delayed input and reconciles it against the latest World", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  const delayed = new SocialService(db, "live-delayed-visitor");
  try {
    delayed.getOrCreatePet({ name: "迟到访客" });
    delayed.joinWorld({ worldId, ruleVersion: 1 });
    owner.enterWorld({ worldId, clientSessionId: "owner-concurrency-host" });
    visitor.enterWorld({ worldId, clientSessionId: "first-visitor-session" });
    delayed.enterWorld({ worldId, clientSessionId: "delayed-visitor-session" });
    owner.takeoverWorldHost({
      worldId,
      clientSessionId: "owner-concurrency-host",
    });

    const firstObserved = visitor.observeWorld({ worldId });
    const delayedObserved = delayed.observeWorld({ worldId });
    assert.equal(firstObserved.state_version, 1);
    assert.equal(delayedObserved.state_version, 1);

    const first = visitor.actInWorld({
      worldId,
      eventType: "key.take",
      bodyText: "我拿起了柜台上唯一的钥匙。",
      proposedWorldStatePatch: {
        key_holder: visitor.getProfile().id,
      },
      observedWorldStateVersion: firstObserved.state_version,
      observedMemberStateVersion: firstObserved.member_state_version,
      idempotencyKey: "first-takes-key",
      requireLive: true,
    });
    owner.resolveWorldHostInput({
      worldId,
      inputId: first.input.id,
      clientSessionId: "owner-concurrency-host",
      decision: "accepted",
      outcomeText: "第一位访客拿走了唯一的钥匙。",
      expectedWorldStateVersion: 1,
      applyProposedState: true,
    });

    const lateInput = delayed.actInWorld({
      worldId,
      eventType: "key.take",
      bodyText: "我也伸手拿起柜台上的钥匙。",
      observedWorldStateVersion: delayedObserved.state_version,
      observedMemberStateVersion: delayedObserved.member_state_version,
      idempotencyKey: "delayed-takes-key",
      requireLive: true,
    });
    assert.equal(lateInput.input.observed_world_state_version, 1);
    assert.equal(lateInput.input.received_world_state_version, 2);
    assert.equal(lateInput.input.context_changed_on_arrival, true);

    const next = owner.nextWorldHostInput({
      worldId,
      clientSessionId: "owner-concurrency-host",
    });
    assert.equal(next.input.id, lateInput.input.id);
    assert.equal(next.concurrency.stale_on_arrival, true);
    assert.equal(next.concurrency.is_stale, true);
    assert.equal(next.concurrency.current_world_state_version, 2);
    assert.ok(next.concurrency.intervening_world_changes.length > 0);

    expectCode(
      () =>
        owner.resolveWorldHostInput({
          worldId,
          inputId: lateInput.input.id,
          clientSessionId: "owner-concurrency-host",
          decision: "accepted",
          outcomeText: "不能把旧行动直接当作仍然有效。",
          expectedWorldStateVersion: 2,
        }),
      "STALE_WORLD_INPUT",
    );

    const reconciled = owner.resolveWorldHostInput({
      worldId,
      inputId: lateInput.input.id,
      clientSessionId: "owner-concurrency-host",
      decision: "accepted",
      resolutionDisposition: "absorbed",
      outcomeText: "你伸手时，钥匙已经被拿走；这个同时发生的动作成为了你们第一次正面相遇。",
      expectedWorldStateVersion: 2,
      applyProposedState: false,
    });
    assert.equal(reconciled.judgement.resolution_disposition, "absorbed");
    assert.equal(
      reconciled.host_response.concurrency.resolution_disposition,
      "absorbed",
    );
    assert.equal(reconciled.world_state.version, 2);
    assert.match(
      reconciled.host_response.next_guidance.message,
      /没有重复改写世界/,
    );
    assert.match(
      reconciled.host_response.next_guidance.objective,
      /当前共享状态/,
    );
    assert.equal(
      reconciled.world_state.value.key_holder,
      visitor.getProfile().id,
    );
  } finally {
    db.close();
  }
});

test("the Host collects a quorum and resolves the whole interaction atomically", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  const second = new SocialService(db, "live-second-visitor");
  const late = new SocialService(db, "live-late-visitor");
  try {
    second.getOrCreatePet({ name: "第二位访客" });
    late.getOrCreatePet({ name: "迟到的访客" });
    second.joinWorld({ worldId, ruleVersion: 1 });
    late.joinWorld({ worldId, ruleVersion: 1 });
    owner.enterWorld({ worldId, clientSessionId: "collective-owner" });
    visitor.enterWorld({ worldId, clientSessionId: "collective-first" });
    second.enterWorld({ worldId, clientSessionId: "collective-second" });
    late.enterWorld({ worldId, clientSessionId: "collective-late" });
    owner.takeoverWorldHost({
      worldId,
      clientSessionId: "collective-owner",
    });

    const opened = owner.openWorldHostInteraction({
      worldId,
      clientSessionId: "collective-owner",
      promptText: "今晚应该优先修屋顶，还是扩建厨房？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      lateInputPolicy: "expire",
      coordinationRule:
        "若意见分歧，先处理当前已经发生的安全风险，其他有效方案保留为后续计划。",
      expectedWorldStateVersion: 1,
    });
    assert.equal(opened.interaction.status, "open");
    assert.equal(opened.interaction.response_count, 0);
    assert.match(opened.prompt_event.body_text, /回应完全可选/);
    assert.match(opened.prompt_event.body_text, /法定人数（quorum）/);
    assert.match(opened.prompt_event.body_text, /当前已收到 0 份回应/);
    assert.match(opened.prompt_event.body_text, /至少需要 2 份回应/);
    assert.match(opened.prompt_event.body_text, /120 秒后截止/);
    assert.match(opened.prompt_event.body_text, /单独回应.*不会改变共享世界/s);
    assert.match(opened.prompt_event.body_text, /分歧协调规则/);
    assert.match(opened.prompt_event.body_text, /截止后的内容不会计入/);
    assert.match(opened.interaction.coordination_rule, /安全风险/);
    assert.equal(
      visitor.observeWorld({ worldId }).active_interactions[0].prompt_event_id,
      opened.prompt_event.id,
    );

    const firstObserved = visitor.observeWorld({ worldId });
    const first = visitor.actInWorld({
      worldId,
      eventType: "collective.vote",
      bodyText: "先修屋顶，雨季快到了。",
      replyToEventId: opened.prompt_event.id,
      observedWorldStateVersion: firstObserved.state_version,
      observedMemberStateVersion: firstObserved.member_state_version,
      idempotencyKey: "collective-first-response",
      requireLive: true,
    });
    assert.equal(first.status, "collecting");
    assert.equal(first.input.visibility, "actor");
    assert.equal(first.input.interaction_id, opened.interaction.id);
    assert.equal(first.interaction.prompt_text, opened.prompt_event.body_text);
    assert.match(first.host_response.outcome_text, /1\/2/);
    assert.match(first.host_response.outcome_text, /还差 1 位/);
    assert.match(first.host_response.outcome_text, /尚未改变共享世界/);
    assert.match(first.host_response.next_guidance.message, /不必停在这里等待/);
    expectCode(
      () =>
        visitor.actInWorld({
          worldId,
          bodyText: "我想改票。",
          replyToEventId: opened.prompt_event.id,
          visibility: "actor",
          observedWorldStateVersion: firstObserved.state_version,
          observedMemberStateVersion: firstObserved.member_state_version,
          idempotencyKey: "collective-duplicate-response",
          requireLive: true,
        }),
      "WORLD_INTERACTION_ALREADY_RESPONDED",
    );

    const secondObserved = second.observeWorld({ worldId });
    assert.equal(
      secondObserved.events.some((event) => event.id === first.input.id),
      false,
    );
    const secondResponse = second.actInWorld({
      worldId,
      eventType: "collective.vote",
      bodyText: "也先修屋顶，厨房可以之后扩建。",
      replyToEventId: opened.prompt_event.id,
      visibility: "world",
      observedWorldStateVersion: secondObserved.state_version,
      observedMemberStateVersion: secondObserved.member_state_version,
      idempotencyKey: "collective-second-response",
      requireLive: true,
    });
    assert.equal(secondResponse.status, "ready_for_host");
    assert.equal(secondResponse.input.visibility, "actor");
    assert.match(secondResponse.host_response.outcome_text, /2\/2/);
    assert.match(secondResponse.host_response.outcome_text, /等待 Host 统一结算/);
    assert.match(secondResponse.host_response.outcome_text, /没有改变共享世界/);

    const next = owner.nextWorldHostInput({
      worldId,
      clientSessionId: "collective-owner",
    });
    assert.equal(next.batch_mode, true);
    assert.equal(next.interaction.id, opened.interaction.id);
    assert.deepEqual(
      next.input_batch.map((input) => input.id),
      [first.input.id, secondResponse.input.id],
    );
    expectCode(
      () =>
        owner.resolveWorldHostInput({
          worldId,
          inputId: first.input.id,
          clientSessionId: "collective-owner",
          decision: "accepted",
          expectedWorldStateVersion: 1,
        }),
      "WORLD_INTERACTION_BATCH_REQUIRED",
    );

    expectCode(
      () => owner.resolveWorldHostInteraction({
        worldId,
        interactionId: opened.interaction.id,
        clientSessionId: "collective-owner",
        decision: "accepted",
        reasonText: "这次尝试故意泄露私人回应。",
        outcomeText: `公开原文：${first.input.body_text}`,
        result: { leaked_input_id: first.input.id },
        expectedWorldStateVersion: 1,
      }),
      "COLLECTIVE_PRIVATE_DATA_LEAK",
    );

    const resolved = owner.resolveWorldHostInteraction({
      worldId,
      interactionId: opened.interaction.id,
      clientSessionId: "collective-owner",
      decision: "accepted",
      reasonText: "两位成员都选择先处理雨季风险。",
      outcomeText: "大家决定先修屋顶，木料已经运到阁楼。",
      result: { selected_plan: "repair_roof" },
      worldStatePatch: { collective_plan: "repair_roof" },
      expectedWorldStateVersion: 1,
    });
    assert.equal(resolved.interaction.status, "resolved");
    assert.equal(resolved.inputs.length, 2);
    assert.equal(resolved.world_state.version, 2);
    assert.equal(resolved.world_state.value.collective_plan, "repair_roof");
    assert.equal(resolved.outcome.visibility, "world");
    assert.match(resolved.outcome.body_text, /事前公布的分歧协调规则/);
    assert.match(resolved.outcome.body_text, /安全风险/);

    const firstEvents = visitor.observeWorld({
      worldId,
      afterSequence: 0,
    }).events;
    assert.ok(firstEvents.some((event) => event.id === first.input.id));
    assert.ok(firstEvents.some((event) => event.id === resolved.outcome.id));
    assert.equal(
      firstEvents.some((event) => event.id === secondResponse.input.id),
      false,
    );
    const secondEvents = second.observeWorld({
      worldId,
      afterSequence: 0,
    }).events;
    assert.equal(
      secondEvents.some((event) => event.id === first.input.id),
      false,
    );

    const lateObserved = late.observeWorld({ worldId });
    expectCode(
      () =>
        late.actInWorld({
          worldId,
          bodyText: "我也支持先修屋顶。",
          replyToEventId: opened.prompt_event.id,
          observedWorldStateVersion: lateObserved.state_version,
          observedMemberStateVersion: lateObserved.member_state_version,
          idempotencyKey: "collective-expired-response",
          requireLive: true,
        }),
      "WORLD_INTERACTION_CLOSED",
    );
  } finally {
    db.close();
  }
});

test("a response window becomes ready at its deadline and late follow-ups stay immediate", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  try {
    owner.enterWorld({ worldId, clientSessionId: "window-owner" });
    visitor.enterWorld({ worldId, clientSessionId: "window-visitor" });
    owner.takeoverWorldHost({
      worldId,
      clientSessionId: "window-owner",
    });
    const opened = owner.openWorldHostInteraction({
      worldId,
      clientSessionId: "window-owner",
      promptText: "还有人想为明天的旅馆活动补充安排吗？",
      mode: "windowed",
      windowSeconds: 60,
      lateInputPolicy: "follow_up",
      coordinationRule: "Host 按当前公开事实协调分歧，并保留未采用意见。",
      expectedWorldStateVersion: 1,
    });
    assert.match(opened.prompt_event.body_text, /回应完全可选/);
    assert.match(opened.prompt_event.body_text, /限时窗口（windowed）/);
    assert.match(opened.prompt_event.body_text, /60 秒后截止/);
    assert.match(opened.prompt_event.body_text, /新的后续建议/);
    const beforeDeadline = owner.nextWorldHostInput({
      worldId,
      clientSessionId: "window-owner",
    });
    assert.equal(beforeDeadline.input, null);
    assert.equal(beforeDeadline.active_interactions[0].status, "open");

    db.prepare(`
      UPDATE world_interactions
      SET closes_at = '2000-01-01T00:00:00.000Z'
      WHERE id = ?
    `).run(opened.interaction.id);
    const observed = visitor.observeWorld({ worldId });
    const lateFollowUp = visitor.actInWorld({
      worldId,
      bodyText: "我晚了一点：可以准备一张公共留言板。",
      replyToEventId: opened.prompt_event.id,
      observedWorldStateVersion: observed.state_version,
      observedMemberStateVersion: observed.member_state_version,
      idempotencyKey: "window-late-follow-up",
      requireLive: true,
    });
    assert.equal(lateFollowUp.status, "pending");
    assert.equal(lateFollowUp.input.interaction_id, null);
    assert.match(lateFollowUp.host_response.reason_text, /原集体回应窗口已经截止/);
    assert.match(lateFollowUp.host_response.outcome_text, /不计入已经结束的集体批次/);

    const ready = owner.nextWorldHostInput({
      worldId,
      clientSessionId: "window-owner",
    });
    assert.equal(ready.batch_mode, true);
    assert.equal(ready.input_batch.length, 0);
    owner.resolveWorldHostInteraction({
      worldId,
      interactionId: opened.interaction.id,
      clientSessionId: "window-owner",
      decision: "rejected",
      outcomeText: "本轮没有在截止前收到安排，活动保持原计划。",
      expectedWorldStateVersion: 1,
    });
    const nextImmediate = owner.nextWorldHostInput({
      worldId,
      clientSessionId: "window-owner",
    });
    assert.equal(nextImmediate.input.id, lateFollowUp.input.id);
  } finally {
    db.close();
  }
});

test("a collective batch must be rebased when the World changes during collection", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  const second = new SocialService(db, "rebase-second-visitor");
  try {
    second.getOrCreatePet({ name: "后来回应者" });
    second.joinWorld({ worldId, ruleVersion: 1 });
    owner.enterWorld({ worldId, clientSessionId: "rebase-owner" });
    visitor.enterWorld({ worldId, clientSessionId: "rebase-first" });
    second.enterWorld({ worldId, clientSessionId: "rebase-second" });
    owner.takeoverWorldHost({
      worldId,
      clientSessionId: "rebase-owner",
    });
    const opened = owner.openWorldHostInteraction({
      worldId,
      clientSessionId: "rebase-owner",
      promptText: "下一批预算应该用在哪里？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      expectedWorldStateVersion: 1,
    });
    const firstObserved = visitor.observeWorld({ worldId });
    visitor.actInWorld({
      worldId,
      bodyText: "用来修缮客房。",
      replyToEventId: opened.prompt_event.id,
      visibility: "actor",
      observedWorldStateVersion: firstObserved.state_version,
      observedMemberStateVersion: firstObserved.member_state_version,
      idempotencyKey: "rebase-first-vote",
      requireLive: true,
    });

    const ordinaryObserved = visitor.observeWorld({ worldId });
    const ordinary = visitor.actInWorld({
      worldId,
      eventType: "weather.change",
      bodyText: "一场暴雨让院子积了水。",
      proposedWorldStatePatch: { courtyard_flooded: true },
      observedWorldStateVersion: ordinaryObserved.state_version,
      observedMemberStateVersion: ordinaryObserved.member_state_version,
      idempotencyKey: "rebase-intervening-event",
      requireLive: true,
    });
    owner.resolveWorldHostInput({
      worldId,
      inputId: ordinary.input.id,
      clientSessionId: "rebase-owner",
      decision: "accepted",
      applyProposedState: true,
      expectedWorldStateVersion: 1,
    });

    const secondObserved = second.observeWorld({ worldId });
    second.actInWorld({
      worldId,
      bodyText: "先排干院子的积水，再考虑客房。",
      replyToEventId: opened.prompt_event.id,
      visibility: "actor",
      observedWorldStateVersion: secondObserved.state_version,
      observedMemberStateVersion: secondObserved.member_state_version,
      idempotencyKey: "rebase-second-vote",
      requireLive: true,
    });
    expectCode(
      () =>
        owner.resolveWorldHostInteraction({
          worldId,
          interactionId: opened.interaction.id,
          clientSessionId: "rebase-owner",
          decision: "accepted",
          expectedWorldStateVersion: 2,
        }),
      "STALE_WORLD_INTERACTION",
    );
    const rebased = owner.resolveWorldHostInteraction({
      worldId,
      interactionId: opened.interaction.id,
      clientSessionId: "rebase-owner",
      decision: "accepted",
      resolutionDisposition: "rebase",
      outcomeText: "预算方案根据暴雨后的新情况调整为优先排水。",
      worldStatePatch: { collective_plan: "drain_courtyard" },
      expectedWorldStateVersion: 2,
    });
    assert.equal(rebased.resolution_disposition, "rebase");
    assert.equal(rebased.world_state.version, 3);
    assert.equal(rebased.world_state.value.courtyard_flooded, true);
    assert.equal(rebased.world_state.value.collective_plan, "drain_courtyard");
    assert.deepEqual(
      rebased.inputs.map(
        (input) => input.judgement.resolution_disposition,
      ),
      ["rebase", "apply"],
    );
  } finally {
    db.close();
  }
});

test("stale live sessions expire while Codex heartbeats keep active Worlds live", () => {
  const { db, owner, visitor, worldId } = createLiveFixture();
  try {
    visitor.enterWorld({ worldId, clientSessionId: "heartbeat-session" });
    db.prepare(`
      UPDATE world_sessions
      SET last_active_at = '2000-01-01T00:00:00.000Z'
      WHERE space_id = ?
    `).run(worldId);

    visitor.heartbeatWorldPresence({ codexOpen: true });
    assert.equal(
      owner.getWorldHostRuntime({ worldId }).runtime.status,
      "active",
    );

    db.prepare(`
      UPDATE world_sessions
      SET last_active_at = '2000-01-01T00:00:00.000Z'
      WHERE space_id = ?
    `).run(worldId);
    const expired = owner.getWorldHostRuntime({ worldId }).runtime;
    assert.equal(expired.status, "idle");
    assert.equal(expired.active_member_count, 0);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM presence WHERE space_id = ?")
        .get(worldId).count,
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
  } finally {
    db.close();
  }
});

async function registerClient(address, suffix) {
  const registration = await PetSocialClient.register(address.url, {
    recoveryEmail: `${suffix}@example.test`,
    displayName: `pet-${suffix}`,
  });
  return {
    registration,
    client: new PetSocialClient({
      serverUrl: address.url,
      token: registration.token,
    }),
  };
}

test("the shared MCP exposes direct World entry and creator Host takeover", async () => {
  const store = new PetSocialStore();
  let deadlineCallback = null;
  const app = createPetSocialApp({
    store,
    setTimeout(callback) {
      deadlineCallback = callback;
      return { unref() {} };
    },
    clearTimeout() {},
  });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "live-mcp-owner");
    const visitor = await registerClient(address, "live-mcp-visitor");
    const world = await owner.client.createWorld({
      name: "实时共同经营",
      rulesText: "所有互动由当前世界主持统一结算。",
      definitionText: "宠物们共同经营一家持续变化的店铺。",
      resolutionMode: "direct",
      initialWorldState: { customers: 0 },
    });
    await owner.client.publishWorld(world.id, {
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    await visitor.client.joinWorld(world.id, { ruleVersion: 1 });

    await assert.rejects(
      () =>
        callWorldTool(visitor.client, "world_input_submit", {
          world_id: world.id,
          input_type: "action",
          body_text: "尚未进入就尝试行动。",
          idempotency_key: "remote-not-entered",
        }),
      (error) => error.status === 409 && error.code === "WORLD_NOT_ENTERED",
    );

    await callWorldTool(owner.client, "world_enter", {
      world_id: world.id,
      client_session_id: "owner-codex-task",
    });
    const visitorEntry = await callWorldTool(visitor.client, "world_enter", {
      world_id: world.id,
      client_session_id: "visitor-codex-task",
    });
    const claimed = await callWorldTool(
      owner.client,
      "world_host_takeover",
      {
        world_id: world.id,
        client_session_id: "owner-codex-task",
      },
    );
    assert.equal(claimed.runtime.active_executor, "creator_codex");

    const pending = await callWorldTool(
      visitor.client,
      "world_input_submit",
      {
        world_id: world.id,
        input_type: "action",
        event_type: "serve",
        body_text: "我为第一位客人准备了热茶。",
        observed_world_state_version: visitorEntry.state_version,
        observed_member_state_version: visitorEntry.member_state_version,
        idempotency_key: "remote-live-serve",
      },
    );
    assert.equal(pending.status, "pending");

    const hostNotification = store.db
      .prepare(`
        SELECT * FROM events
        WHERE pet_id = ? AND event_type = 'world.host_input_pending'
        ORDER BY id DESC LIMIT 1
      `)
      .get(owner.registration.pet.id);
    assert.ok(hostNotification);

    const next = await callWorldTool(
      owner.client,
      "world_host_next_input",
      {
        world_id: world.id,
        client_session_id: "owner-codex-task",
      },
    );
    assert.equal(next.input.id, pending.input.id);

    const resolved = await callWorldTool(
      owner.client,
      "world_host_resolve",
      {
        world_id: world.id,
        input_id: next.input.id,
        client_session_id: "owner-codex-task",
        decision: "accepted",
        outcome_text: "客人接过热茶，店里的气氛变得温暖起来。",
        expected_world_state_version: 1,
        apply_proposed_state: false,
      },
    );
    assert.equal(resolved.status, "accepted");

    const interaction = await callWorldTool(
      owner.client,
      "world_host_interaction_open",
      {
        world_id: world.id,
        client_session_id: "owner-codex-task",
        prompt_text: "是否把明天设为公共品茶日？",
        mode: "windowed",
        window_seconds: 60,
        late_input_policy: "follow_up",
        expected_world_state_version: 1,
      },
    );
    const collectiveResponse = await callWorldTool(
      visitor.client,
      "world_input_submit",
      {
        world_id: world.id,
        input_type: "choice",
        event_type: "collective.choice",
        body_text: "我赞成公共品茶日。",
        reply_to_event_id: interaction.prompt_event.id,
        visibility: "actor",
        observed_world_state_version: visitorEntry.state_version,
        observed_member_state_version: visitorEntry.member_state_version,
        idempotency_key: "remote-collective-response",
      },
    );
    assert.equal(collectiveResponse.status, "collecting");
    store.db.prepare(`
      UPDATE world_interactions
      SET closes_at = '2000-01-01T00:00:00.000Z'
      WHERE id = ?
    `).run(interaction.interaction.id);
    assert.equal(typeof deadlineCallback, "function");
    deadlineCallback();
    assert.equal(
      store.db
        .prepare("SELECT status FROM world_interactions WHERE id = ?")
        .get(interaction.interaction.id).status,
      "ready",
    );
    const deadlineNotification = store.db
      .prepare(`
        SELECT * FROM events
        WHERE pet_id = ? AND event_type = 'world.interaction_ready'
        ORDER BY id DESC LIMIT 1
      `)
      .get(owner.registration.pet.id);
    assert.ok(deadlineNotification);
    const collectiveBatch = await callWorldTool(
      owner.client,
      "world_host_next_input",
      {
        world_id: world.id,
        client_session_id: "owner-codex-task",
      },
    );
    assert.equal(collectiveBatch.batch_mode, true);
    assert.equal(collectiveBatch.input_batch.length, 1);
    const collectiveResult = await callWorldTool(
      owner.client,
      "world_host_interaction_resolve",
      {
        world_id: world.id,
        interaction_id: interaction.interaction.id,
        client_session_id: "owner-codex-task",
        decision: "accepted",
        outcome_text: "明天将举办公共品茶日。",
        expected_world_state_version: 1,
      },
    );
    assert.equal(collectiveResult.interaction.status, "resolved");
    assert.equal(collectiveResult.outcome.visibility, "world");

    const visitorNotification = store.db
      .prepare(`
        SELECT * FROM events
        WHERE pet_id = ? AND event_type = 'world.event_committed'
        ORDER BY id DESC LIMIT 1
      `)
      .get(visitor.registration.pet.id);
    assert.ok(visitorNotification);

    const left = await callWorldTool(visitor.client, "world_leave", {
      world_id: world.id,
    });
    assert.equal(left.left, true);
  } finally {
    await app.close();
    store.close();
  }
});

test("the MCP registry has no user-facing room layer", () => {
  const names = new Set(worldTools.map((tool) => tool.name));
  for (const name of [
    "world_host_runtime_get",
    "world_host_takeover",
    "world_host_heartbeat",
    "world_host_release",
    "world_host_next_input",
    "world_host_interaction_open",
    "world_host_interaction_resolve",
    "world_host_resolve",
    "world_enter",
    "world_leave",
    "world_present",
  ]) {
    assert.equal(names.has(name), true, `missing live World tool: ${name}`);
  }
  assert.equal(
    [...names].some((name) => name.startsWith("world_room_")),
    false,
  );
  const submitTool = worldTools.find(
    (tool) => tool.name === "world_input_submit",
  );
  assert.ok(
    submitTool.inputSchema.required.includes("observed_world_state_version"),
  );
  assert.ok(
    submitTool.inputSchema.required.includes("observed_member_state_version"),
  );
  const resolveTool = worldTools.find(
    (tool) => tool.name === "world_host_resolve",
  );
  assert.ok(
    resolveTool.inputSchema.required.includes("expected_world_state_version"),
  );
  assert.deepEqual(
    resolveTool.inputSchema.properties.resolution_disposition.enum,
    ["apply", "rebase", "conflict", "absorbed", "expired"],
  );
  const openInteractionTool = worldTools.find(
    (tool) => tool.name === "world_host_interaction_open",
  );
  assert.ok(
    openInteractionTool.inputSchema.required.includes(
      "expected_world_state_version",
    ),
  );
  const resolveInteractionTool = worldTools.find(
    (tool) => tool.name === "world_host_interaction_resolve",
  );
  assert.ok(
    resolveInteractionTool.inputSchema.required.includes(
      "expected_world_state_version",
    ),
  );
});
