import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/venue-lab-core/database.js";
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
  const owner = new SocialService(db, "host-owner");
  const visitor = new SocialService(db, "host-visitor");
  const outsider = new SocialService(db, "host-outsider");
  owner.getOrCreatePet({ name: "旅馆主人" });
  visitor.getOrCreatePet({ name: "初次访客" });
  outsider.getOrCreatePet({ name: "路过宠物" });
  const world = owner.createWorld({
    name: "万象旅馆测试",
    description: "用于验证真实首访路径。",
    tags: ["旅馆", "共同经营"],
    rulesText: "每只宠物只决定自己的角色；重要变化由世界主持裁决。",
    definitionText: "成员自由选择旅馆相关身份，共同经营并积累持续状态。",
    entryPrompt: "选择一个旅馆相关身份，然后完成第一件实际参与。",
    resolutionMode: "direct",
  });
  owner.updateWorldHost({
    worldId: world.id,
    expectedVersion: 1,
    name: "夜铃管家",
    onboardingPolicy: {
      welcome_text: "雨夜里，旅馆门铃响起，第一批住客即将到来。",
      setup_prompt: "请选择一个身份。",
      starter_choices: [
        {
          id: "front-desk",
          label: "前台",
          input_type: "choice",
          event_type: "host.onboarding.role_selected",
          body_text: "我以前台身份加入。",
          data: { role: "前台" },
        },
        {
          id: "cook",
          label: "厨师",
          input_type: "choice",
          event_type: "host.onboarding.role_selected",
          body_text: "我以厨师身份加入。",
          data: { role: "厨师" },
        },
      ],
      free_input_prompt: "也可以自定义一个旅馆相关身份。",
    },
    facilitationPolicy: {
      objective_text: "选择身份并完成第一次旅馆工作。",
      next_actions: ["接待第一位住客", "检查漏雨的阁楼", "准备今日菜单"],
      free_input_prompt: "也可以描述其他符合旅馆场景的行动。",
    },
    recapPolicy: { enabled: true, max_events: 4 },
    proactivity: "active",
  });
  owner.publishWorld({
    worldId: world.id,
    expectedSpecVersion: 1,
    expectedRuleVersion: 1,
    expectedProfileVersion: 1,
    expectedHostVersion: 2,
  });
  return { db, owner, visitor, outsider, worldId: world.id };
}

test("a World Host guides first entry, role setup, first contribution, and return", () => {
  const { db, visitor, worldId } = fixture();
  try {
    const joined = visitor.joinWorld({ worldId, ruleVersion: 1 });
    assert.equal(joined.membership.status, "active");
    assert.equal(joined.host_guidance.next_action, "world_enter");
    assert.match(joined.host_guidance.message, /夜铃管家/);

    const entered = visitor.enterWorld({
      worldId,
      clientSessionId: "first-visit",
    });
    assert.equal(entered.world.world_agent.role, "host");
    assert.equal(entered.world.world_agent.runtime_role, "referee");
    assert.equal(entered.host_guidance.kind, "welcome");
    assert.equal(entered.host_guidance.stage, "setup");
    assert.equal(entered.host_guidance.host.name, "夜铃管家");
    assert.deepEqual(
      entered.host_guidance.choices.map((choice) => choice.label),
      ["前台", "厨师"],
    );
    assert.match(entered.host_guidance.message, /雨夜/);
    assert.match(entered.host_guidance.message, /选择一个旅馆相关身份/);
    assert.equal(
      entered.host_guidance.message.match(/选择一个旅馆相关身份，然后完成第一件实际参与。/gu)?.length,
      1,
    );

    const role = visitor.actInWorld({
      worldId,
      inputType: "choice",
      eventType: "host.onboarding.role_selected",
      bodyText: "我以前台身份加入。",
      data: { role: "前台" },
      idempotencyKey: "host-role-front-desk",
    });
    assert.equal(role.status, "accepted");
    assert.match(role.judgement.outcome_text, /确认了初次访客的身份：前台/);
    assert.equal(role.member_state.value.role, "前台");
    assert.equal(role.journey.current_role, "前台");
    assert.equal(role.journey.stage, "setup");
    assert.equal(role.host_guidance.kind, "setup");
    assert.deepEqual(
      role.host_guidance.choices.map((choice) => choice.label),
      ["接待第一位住客", "检查漏雨的阁楼", "准备今日菜单"],
    );

    const contribution = visitor.actInWorld({
      worldId,
      inputType: "action",
      eventType: "guest.check_in",
      bodyText: "我为第一位住客办理入住并递上房间钥匙。",
      idempotencyKey: "host-first-contribution",
    });
    assert.equal(contribution.status, "accepted");
    assert.match(
      contribution.judgement.outcome_text,
      /为第一位住客办理入住/,
    );
    assert.equal(contribution.journey.stage, "active");
    assert.ok(contribution.journey.onboarding_completed_at);
    assert.equal(contribution.host_guidance.kind, "progress");
    assert.equal(contribution.host_guidance.choices.length, 3);

    visitor.leaveWorld({ worldId });
    const returned = visitor.enterWorld({
      worldId,
      clientSessionId: "return-visit",
    });
    assert.equal(returned.host_guidance.kind, "recap");
    assert.equal(returned.host_guidance.stage, "returning");
    assert.equal(returned.host_guidance.journey.visit_count, 2);
    assert.match(returned.host_guidance.context_summary, /没有新的公开变化|接受/);
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_host_turns
          WHERE space_id = ? AND pet_id = ?
        `)
        .get(worldId, visitor.getProfile().id).count,
      4,
    );
  } finally {
    db.close();
  }
});

test("World Host configuration is owner-only and uses optimistic versions", () => {
  const { db, owner, outsider, worldId } = fixture();
  try {
    const current = owner.getWorldHost({ worldId }).host;
    assert.equal(current.role, "host");
    assert.equal(current.version, 2);
    assert.deepEqual(current.capabilities, [
      "guide",
      "inhabit",
      "facilitate",
      "coordinate",
      "judge",
      "advance",
      "remember",
      "recap",
    ]);
    assert.equal(current.world_role, "host");
    assert.equal(current.participation_policy.mode, "hybrid");
    assert.equal(current.participation_policy.solo_enabled, true);
    assert.equal(current.evolution_policy.persistence, "persistent");
    expectCode(
      () =>
        outsider.updateWorldHost({
          worldId,
          expectedVersion: 2,
          proactivity: "quiet",
        }),
      "FORBIDDEN",
    );
    const next = owner.updateWorldHost({
      worldId,
      expectedVersion: 2,
      worldRole: "npc",
      participationPolicy: {
        mode: "solo",
        solo_enabled: true,
        multiplayer_enabled: false,
      },
      proactivity: "balanced",
    }).host;
    assert.equal(next.version, 3);
    assert.equal(next.proactivity, "balanced");
    assert.equal(next.world_role, "npc");
    assert.equal(next.participation_policy.mode, "solo");
    expectCode(
      () =>
        owner.updateWorldHost({
          worldId,
          expectedVersion: 2,
          proactivity: "active",
        }),
      "WORLD_HOST_VERSION_MISMATCH",
    );
  } finally {
    db.close();
  }
});

test("generic non-game worlds receive guidance without requiring a role system", () => {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "community-owner");
  const visitor = new SocialService(db, "community-visitor");
  try {
    owner.getOrCreatePet({ name: "社区发起者" });
    visitor.getOrCreatePet({ name: "社区新人" });
    const world = owner.createWorld({
      name: "共同讨论室",
      rulesText: "尊重他人，不替别人发言。",
      definitionText: "成员围绕共同关心的问题进行讨论和协作。",
      entryPrompt: "说说你今天最想讨论或贡献什么。",
    });
    owner.publishWorld({
      worldId: world.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    visitor.joinWorld({ worldId: world.id, ruleVersion: 1 });
    const entered = visitor.enterWorld({ worldId: world.id });
    assert.equal(entered.host_guidance.kind, "welcome");
    assert.equal(
      entered.host_guidance.choices.some(
        (choice) => choice.event_type === "host.onboarding.role_selected",
      ),
      false,
    );
    assert.match(entered.host_guidance.free_input_prompt, /直接说/);
  } finally {
    db.close();
  }
});

test("a simple World with an authored opening never shows template placeholder copy", () => {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "simple-opening-owner");
  const visitor = new SocialService(db, "simple-opening-visitor");
  try {
    owner.getOrCreatePet({ name: "雨港店主" });
    visitor.getOrCreatePet({ name: "第一次靠岸的人" });
    const world = owner.createWorld({
      name: "雨港修船铺",
      description: "潮水每天带来不同损坏的船。",
      rulesText: "每个人只能决定自己的行动，结果由主持裁决。",
      definitionText: "港口修船铺会留下修理和承诺的痕迹。",
      entryPrompt: "傍晚潮水刚退，一艘漏水小船卡在船坞边，船主正焦急地向你求助。",
    });
    owner.publishWorld({
      worldId: world.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    visitor.joinWorld({ worldId: world.id, ruleVersion: 1 });
    const entered = visitor.enterWorld({ worldId: world.id, clientSessionId: "rain-port" });
    const playerCopy = JSON.stringify(entered.host_guidance);
    assert.match(entered.host_guidance.message, /漏水小船/u);
    assert.doesNotMatch(playerCopy, /通用持久多人世界基座|信息不足|了解当前局势|领取可完成/u);
    assert.doesNotMatch(playerCopy, /通用导演/u);
    assert.match(entered.host_guidance.message, /雨港修船铺主持人欢迎/u);
    assert.ok(entered.host_guidance.choices.every((choice) => /漏水小船|船坞|船主|眼前的情况/u.test(`${choice.label} ${choice.body_text}`)));
  } finally {
    db.close();
  }
});
