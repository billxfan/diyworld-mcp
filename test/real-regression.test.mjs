import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";
import { OFFICIAL_WORLD_VERSION } from "../src/venue-lab-core/database.js";

async function registerClient(address, suffix) {
  const registration = await PetSocialClient.register(address.url, {
    recoveryEmail: `${suffix}@regression.test`,
    displayName: `回归宠物-${suffix}`,
  });
  return {
    registration,
    client: new PetSocialClient({
      serverUrl: address.url,
      token: registration.token,
    }),
  };
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error?.code === code,
  );
}

async function publishV1(client, world) {
  return client.publishWorld(world.id, {
    expectedSpecVersion: world.spec_version,
    expectedRuleVersion: world.rule_version,
    expectedProfileVersion: world.profile_version,
    expectedHostVersion: world.world_agent.version,
  });
}

test("real journey: Builder creation, visitor play, privacy, governance, and rerule", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "builder-owner");
    const visitor = await registerClient(address, "builder-visitor");
    const outsider = await registerClient(address, "builder-outsider");

    const build = await owner.client.startWorldBuild({
      briefText: "一个成员共同维护夜市、可以自由交谈和交换物品的持久世界。",
      templateId: "social-director",
      artifact: {
        world: {
          name: "萤火夜市",
          description: "一座由成员共同维护秩序的夜间集市。",
          tags: ["夜市", "共建"],
          rulesText: "禁止偷窃；只决定自己的行动；交换必须双方同意。",
          definitionText:
            "成员可以逛摊、聊天、维护公共设施，并进行双方同意的物品交换。",
        },
      },
    });
    assert.equal(build.status, "validated");
    assert.equal(build.validation.readiness, "ready");

    const materialized = await owner.client.materializeWorldBuild(build.id, {
      expectedVersion: build.version,
      confirmed: true,
    });
    const draft = materialized.world;
    assert.equal(draft.publication_status, "draft");
    assert.equal((await visitor.client.worlds("萤火夜市")).worlds.length, 0);
    await expectCode(visitor.client.world(draft.id), "NOT_FOUND");

    const world = await publishV1(owner.client, draft);
    assert.equal(world.publication_status, "published");
    assert.equal((await visitor.client.worlds("萤火夜市")).worlds[0].id, world.id);

    await visitor.client.joinWorld(world.id, { ruleVersion: world.rule_version });
    const entered = await visitor.client.enterWorld(world.id, {
      clientSessionId: "real-builder-first-entry",
    });
    assert.equal(entered.host_response.status, "ready_for_input");
    const repeated = await visitor.client.enterWorld(world.id, {
      clientSessionId: "real-builder-repeated-entry",
    });
    assert.equal(repeated.host_guidance.journey.visit_count, 1);
    assert.equal(
      store.db
        .prepare(`
          SELECT visit_count FROM world_member_journeys
          WHERE space_id = ? AND pet_id = ?
        `)
        .get(world.id, visitor.registration.pet.id).visit_count,
      1,
    );

    const normal = await visitor.client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "market.clean",
      bodyText: "我把入口旁的空纸杯收进回收箱。",
      idempotencyKey: "real-market-clean",
    });
    assert.equal(normal.status, "accepted");
    const replay = await visitor.client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "market.clean",
      bodyText: "这次重试不应生成第二次清理。",
      idempotencyKey: "real-market-clean",
    });
    assert.equal(replay.input.id, normal.input.id);

    const prohibited = await visitor.client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "market.take",
      bodyText: "我趁摊主转身偷走柜台上的钱袋。",
      idempotencyKey: "real-market-steal",
    });
    assert.equal(prohibited.status, "rejected");
    assert.match(prohibited.host_response.reason_text, /禁止偷窃/);

    const proposal = await visitor.client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "market.claim",
      bodyText: "我提议把中央摊位登记为自己的。",
      proposedWorldStatePatch: { owner_of_market: visitor.registration.pet.id },
      expectedWorldStateVersion: 1,
      idempotencyKey: "real-market-state-proposal",
    });
    assert.equal(proposal.status, "clarification");
    assert.equal(proposal.world_state.value.owner_of_market, undefined);

    const privateInput = await visitor.client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "这是只留给我自己的夜市备忘。",
      visibility: "actor",
      idempotencyKey: "real-market-private-note",
    });
    const ownerView = await owner.client.observeWorld(world.id, {
      afterSequence: 0,
    });
    const visitorView = await visitor.client.observeWorld(world.id, {
      afterSequence: 0,
    });
    assert.equal(ownerView.events.some((event) => event.id === privateInput.input.id), false);
    assert.equal(visitorView.events.some((event) => event.id === privateInput.input.id), true);

    await outsider.client.joinWorld(world.id, { ruleVersion: world.rule_version });
    const managerInput = await visitor.client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "market.manager_note",
      bodyText: "这是一条只供夜市管理者查看的秩序记录。",
      visibility: "managers",
      idempotencyKey: "real-market-manager-note",
    });
    const managerView = await owner.client.observeWorld(world.id, {
      afterSequence: 0,
    });
    const memberView = await outsider.client.observeWorld(world.id, {
      afterSequence: 0,
    });
    assert.equal(managerView.events.some((event) => event.id === managerInput.input.id), true);
    assert.equal(memberView.events.some((event) => event.id === managerInput.input.id), false);

    await owner.client.addWorldAdmin(world.id, {
      targetPetId: visitor.registration.pet.id,
    });
    const adminEdit = await visitor.client.updateWorld(world.id, {
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      description: "一座由成员共同维护秩序、保持整洁的夜间集市。",
    });
    assert.equal(adminEdit.profile_version, 2);
    await owner.client.removeWorldAdmin(world.id, visitor.registration.pet.id);
    await expectCode(
      visitor.client.updateWorld(world.id, {
        expectedSpecVersion: 1,
        expectedRuleVersion: 1,
        expectedProfileVersion: 2,
        description: "撤权后不应成功。",
      }),
      "FORBIDDEN",
    );

    const reruled = await owner.client.updateWorld(world.id, {
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 2,
      rulesText: "禁止偷窃；只决定自己的行动；所有交换都要明确得到双方同意。",
    });
    assert.equal(reruled.rule_version, 2);
    assert.equal(
      store.db
        .prepare(`
          SELECT COUNT(*) AS count FROM world_sessions
          WHERE space_id = ? AND status = 'active'
        `)
        .get(world.id).count,
      0,
    );
    await expectCode(
      visitor.client.submitWorldInput(world.id, {
        inputType: "speech",
        eventType: "speech",
        bodyText: "旧规则接受状态下不应继续。",
        idempotencyKey: "real-market-stale-rule",
      }),
      "RULE_VERSION_MISMATCH",
    );
    await visitor.client.acceptWorldRules(world.id, { ruleVersion: 2 });
    const returned = await visitor.client.enterWorld(world.id, {
      clientSessionId: "real-builder-return-after-rerule",
    });
    assert.equal(returned.host_guidance.kind, "recap");
    assert.equal(returned.host_guidance.journey.visit_count, 2);

    await expectCode(
      outsider.client.updateWorld(world.id, {
        expectedSpecVersion: 1,
        expectedRuleVersion: 2,
        expectedProfileVersion: 2,
        description: "陌生宠物不应修改世界。",
      }),
      "FORBIDDEN",
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("real journey: profile, friendship, message idempotency, rejection, and blocking", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const alice = await registerClient(address, "social-alice");
    const bob = await registerClient(address, "social-bob");
    const carol = await registerClient(address, "social-carol");

    const before = await alice.client.me();
    const updated = await alice.client.updatePet({ bio: "喜欢修灯和观察云层。" });
    assert.equal(updated.pet.name, before.pet.name);
    assert.equal(updated.pet.visibility, before.pet.visibility);
    assert.equal(updated.pet.bio, "喜欢修灯和观察云层。");

    const request = await alice.client.sendFriendRequest(
      bob.registration.pet.id,
      "real-social-alice-bob",
    );
    const accepted = await bob.client.respondFriendRequest(
      request.friendship.id,
      "accept",
    );
    assert.equal(accepted.friendship.status, "accepted");
    const friendship = (await alice.client.friends()).friends[0];
    assert.equal(friendship.pet.id, bob.registration.pet.id);

    const firstMessage = await alice.client.sendMessage({
      conversationId: friendship.conversationId,
      text: "今晚一起去看灯塔吗？",
      clientMessageId: "real-social-message",
    });
    const duplicateMessage = await alice.client.sendMessage({
      conversationId: friendship.conversationId,
      text: "重复请求不能覆盖原消息。",
      clientMessageId: "real-social-message",
    });
    assert.equal(duplicateMessage.message.id, firstMessage.message.id);
    assert.equal(duplicateMessage.message.text, "今晚一起去看灯塔吗？");
    assert.equal(
      store.db
        .prepare(`
          SELECT COUNT(*) AS count FROM messages
          WHERE sender_pet_id = ? AND client_message_id = ?
        `)
        .get(alice.registration.pet.id, "real-social-message").count,
      1,
    );

    const rejectedRequest = await carol.client.sendFriendRequest(
      alice.registration.pet.id,
      "real-social-carol-alice",
    );
    const rejected = await alice.client.respondFriendRequest(
      rejectedRequest.friendship.id,
      "reject",
    );
    assert.equal(rejected.friendship.status, "rejected");

    const blocked = await alice.client.blockPet(bob.registration.pet.id);
    assert.equal(blocked.blocked, true);
    assert.equal(
      store.db
        .prepare("SELECT status FROM friendships WHERE id = ?")
        .get(blocked.friendshipId).status,
      "blocked",
    );
    await expectCode(
      bob.client.sendMessage({
        conversationId: friendship.conversationId,
        text: "拉黑后不应送达。",
        clientMessageId: "real-social-blocked-message",
      }),
      "NOT_FRIENDS",
    );
    assert.equal((await alice.client.friends()).friends.length, 0);
  } finally {
    await app.close();
    store.close();
  }
});

test("real journey: official Worlds remain solo-complete, asynchronous, and privacy-safe", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const traveler = await registerClient(address, "official-traveler");
    const witness = await registerClient(address, "official-witness");

    const town = await traveler.client.world("official-center-town");
    await traveler.client.joinWorld(town.id, { ruleVersion: town.rule_version });
    const townEntry = await traveler.client.enterWorld(town.id, {
      clientSessionId: "real-center-town-entry",
    });
    assert.equal(townEntry.host_guidance.participation_context.current_mode, "shared");
    assert.equal(townEntry.host_guidance.live_context.currently_alone, true);
    const townContribution = await traveler.client.submitWorldInput(town.id, {
      inputType: "action",
      eventType: "world.public_contribution",
      bodyText: "我整理了车站旁的公告栏，并留下一张欢迎新居民的便签。",
      idempotencyKey: "real-town-contribution",
      requireLive: true,
    });
    assert.equal(townContribution.status, "accepted");

    const survival = await traveler.client.world("official-apocalypse-shelter");
    await traveler.client.joinWorld(survival.id, { ruleVersion: survival.rule_version });
    await traveler.client.enterWorld(survival.id, {
      clientSessionId: "real-survival-entry",
    });
    const built = await traveler.client.submitWorldInput(survival.id, {
      inputType: "action",
      eventType: "survival.production",
      bodyText: "我检查净水器并更换一处磨损密封，让后来者能继续使用。",
      idempotencyKey: "real-survival-repair",
      requireLive: true,
    });
    assert.equal(built.status, "accepted");

    const agency = await traveler.client.world("official-city-detective-agency");
    await traveler.client.joinWorld(agency.id, { ruleVersion: agency.rule_version });
    await traveler.client.enterWorld(agency.id, {
      clientSessionId: "real-detective-entry",
    });
    const role = await traveler.client.submitWorldInput(agency.id, {
      inputType: "choice",
      eventType: "host.onboarding.role_selected",
      bodyText: "我是负责核对现场记录的调查员。",
      data: { role: "现场调查员" },
      idempotencyKey: "real-detective-role",
      requireLive: true,
    });
    assert.equal(role.status, "accepted");
    const privateSecret = await traveler.client.submitWorldInput(agency.id, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "我先私人记录一个尚未验证的嫌疑，不把它写入公共案件档案。",
      visibility: "actor",
      idempotencyKey: "real-detective-private-note",
      requireLive: true,
    });
    assert.equal(privateSecret.status, "accepted");
    const investigated = await traveler.client.submitWorldInput(agency.id, {
      inputType: "action",
      eventType: "world.primary_action",
      bodyText: "我核对案发现场的门禁时间，并把结果留在公共案件档案。",
      idempotencyKey: "real-detective-investigate",
      requireLive: true,
    });
    assert.equal(investigated.status, "accepted");

    await witness.client.joinWorld(agency.id, { ruleVersion: agency.rule_version });
    const witnessView = await witness.client.observeWorld(agency.id, {
      afterSequence: 0,
    });
    assert.equal(
      witnessView.events.some((event) => event.id === privateSecret.input.id),
      false,
    );
    assert.equal(
      witnessView.events.some((event) => /门禁时间/u.test(event.body_text)),
      true,
    );

    const adventure = await traveler.client.world("official-adventurers-guild");
    await traveler.client.joinWorld(adventure.id, { ruleVersion: adventure.rule_version });
    await traveler.client.enterWorld(adventure.id, {
      clientSessionId: "real-adventure-entry",
    });
    const userWorldCountBefore = store.db
      .prepare("SELECT COUNT(*) AS count FROM spaces WHERE kind = 'user'")
      .get().count;
    const scene = await traveler.client.submitWorldInput(adventure.id, {
      inputType: "choice",
      eventType: "adventure.accept_quest",
      bodyText: "我领取失踪补给车任务，先核对旧路地图和已知风险。",
      idempotencyKey: "real-adventure-quest",
      requireLive: true,
    });
    assert.equal(scene.status, "accepted");
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE kind = 'user'").get().count,
      userWorldCountBefore,
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("real journey: approval, hidden invitation, and cross-World movement", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "access-owner");
    const applicant = await registerClient(address, "access-applicant");
    const outsider = await registerClient(address, "access-outsider");

    const approvalDraft = await owner.client.createWorld({
      name: "审批制观星台",
      visibility: "public",
      joinPolicy: "approval",
      rulesText: "尊重现场成员，只讨论自愿公开的观察记录。",
      definitionText: "成员在观星台记录当晚天空，并交换自愿公开的发现。",
    });
    const approval = await publishV1(owner.client, approvalDraft);
    const pending = await applicant.client.joinWorld(approval.id, {
      ruleVersion: approval.rule_version,
      applicationText: "我想记录今晚的月相。",
    });
    assert.equal(pending.membership.status, "pending");
    await expectCode(
      applicant.client.enterWorld(approval.id, {
        clientSessionId: "real-approval-too-early",
      }),
      "ACTIVE_MEMBERSHIP_REQUIRED",
    );
    const requests = await owner.client.worldJoinRequests(approval.id);
    assert.equal(requests.requests.length, 1);
    await owner.client.respondWorldJoinRequest(
      approval.id,
      applicant.registration.pet.id,
      { decision: "accepted" },
    );
    const approvalEntry = await applicant.client.enterWorld(approval.id, {
      clientSessionId: "real-approval-entry",
    });
    assert.equal(approvalEntry.world.id, approval.id);

    const town = await owner.client.world("official-center-town");
    for (const member of [owner, applicant]) {
      await member.client.joinWorld(town.id, { ruleVersion: town.rule_version });
      await member.client.enterWorld(town.id, {
        clientSessionId: `real-contact-${member.registration.pet.id}`,
      });
    }
    const hiddenDraft = await owner.client.createWorld({
      name: "隐藏信号站",
      visibility: "hidden",
      joinPolicy: "invite_only",
      rulesText: "只有受邀成员可以进入；不得转发邀请。",
      definitionText: "受邀成员可以在信号站共同记录世界内的无线电片段。",
    });
    const hidden = await publishV1(owner.client, hiddenDraft);
    const invitation = await owner.client.createWorldInvitation(hidden.id, {
      targetPetId: applicant.registration.pet.id,
    });
    await expectCode(
      outsider.client.joinWorld(hidden.id, { ruleVersion: hidden.rule_version }),
      "INVITATION_REQUIRED",
    );
    await applicant.client.joinWorld(hidden.id, {
      ruleVersion: hidden.rule_version,
      invitationId: invitation.id,
    });
    const moved = await applicant.client.enterWorld(hidden.id, {
      clientSessionId: "real-hidden-entry",
    });
    assert.equal(moved.moved_from_world_id, town.id);
    const oldJourney = store.db
      .prepare(`
        SELECT last_left_at, last_departure_sequence
        FROM world_member_journeys
        WHERE space_id = ? AND pet_id = ?
      `)
      .get(town.id, applicant.registration.pet.id);
    assert.ok(oldJourney.last_left_at);
    assert.ok(oldJourney.last_departure_sequence > 0);
  } finally {
    await app.close();
    store.close();
  }
});

test("real journey: creator Host takeover queues, resolves, and releases input", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "host-owner");
    const visitor = await registerClient(address, "host-visitor");
    const outsider = await registerClient(address, "host-outsider");
    const draft = await owner.client.createWorld({
      name: "钟楼修复现场",
      rulesText: "只决定自己的行动；重要修复结果由 Host 结算。",
      definitionText: "成员共同修复一座停摆的钟楼，并留下可追踪的进展。",
      initialWorldState: { bell: { repaired: false } },
    });
    const world = await publishV1(owner.client, draft);
    await visitor.client.joinWorld(world.id, { ruleVersion: world.rule_version });
    await owner.client.enterWorld(world.id, {
      clientSessionId: "real-host-owner-session",
    });
    await visitor.client.enterWorld(world.id, {
      clientSessionId: "real-host-visitor-session",
    });
    await expectCode(
      outsider.client.takeoverWorldHost(world.id, {
        clientSessionId: "real-host-outsider-session",
      }),
      "FORBIDDEN",
    );
    await expectCode(
      owner.client.takeoverWorldHost(world.id, {
        clientSessionId: "wrong-owner-session",
      }),
      "WORLD_HOST_SESSION_MISMATCH",
    );
    const claim = await owner.client.takeoverWorldHost(world.id, {
      clientSessionId: "real-host-owner-session",
      leaseSeconds: 90,
    });
    assert.equal(claim.runtime.active_executor, "creator_codex");

    const pending = await visitor.client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "tower.repair",
      bodyText: "我重新接好钟锤的传动链。",
      proposedWorldStatePatch: { bell: { repaired: true } },
      expectedWorldStateVersion: 1,
      idempotencyKey: "real-host-repair",
      requireLive: true,
    });
    assert.equal(pending.status, "pending");
    const next = await owner.client.nextWorldHostInput(world.id, {
      clientSessionId: "real-host-owner-session",
    });
    assert.equal(next.input.id, pending.input.id);
    const resolved = await owner.client.resolveWorldHostInput(
      world.id,
      pending.input.id,
      {
        clientSessionId: "real-host-owner-session",
        decision: "accepted",
        reasonText: "传动链连接方式符合当前钟楼结构。",
        outcomeText: "钟锤恢复传动，钟楼完成了第一阶段修复。",
        worldStatePatch: { bell: { repaired: true } },
        expectedWorldStateVersion: 1,
      },
    );
    assert.equal(resolved.status, "accepted");
    assert.equal(resolved.world_state.value.bell.repaired, true);
    const released = await owner.client.releaseWorldHost(world.id, {
      clientSessionId: "real-host-owner-session",
    });
    assert.equal(released.runtime.active_executor, "platform");
    const platformResult = await visitor.client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "第一阶段修复完成了。",
      idempotencyKey: "real-host-platform-resumed",
      requireLive: true,
    });
    assert.equal(platformResult.status, "accepted");
  } finally {
    await app.close();
    store.close();
  }
});

test("real journey: persistent database reopens with World, Host, state, and journey intact", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pet-social-real-regression-"));
  const databasePath = join(directory, "social.sqlite");
  let store = new PetSocialStore(databasePath);
  let app = createPetSocialApp({ store });
  let address = await app.listen();
  try {
    const owner = await registerClient(address, "restart-owner");
    const visitor = await registerClient(address, "restart-visitor");
    const draft = await owner.client.createWorld({
      name: "重启后的灯塔",
      rulesText: "只修改当前灯塔内的状态。",
      definitionText: "成员逐步点亮一座会跨重启保存进度的灯塔。",
      initialWorldState: { lighthouse: { lit: false } },
    });
    const world = await publishV1(owner.client, draft);
    await visitor.client.joinWorld(world.id, { ruleVersion: 1 });
    await visitor.client.enterWorld(world.id, {
      clientSessionId: "real-restart-before",
    });
    const changed = await visitor.client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "lighthouse.light",
      bodyText: "我点亮灯塔顶层的主灯。",
      proposedWorldStatePatch: { lighthouse: { lit: true } },
      expectedWorldStateVersion: 1,
      idempotencyKey: "real-restart-light",
    });
    assert.equal(changed.world_state.value.lighthouse.lit, true);
    const token = visitor.registration.token;
    const petId = visitor.registration.pet.id;

    await app.close();
    store.close();
    store = new PetSocialStore(databasePath);
    app = createPetSocialApp({ store });
    address = await app.listen();
    const restored = new PetSocialClient({ serverUrl: address.url, token });
    const restoredWorld = await restored.world(world.id);
    assert.equal(restoredWorld.name, "重启后的灯塔");
    assert.equal(restoredWorld.world_agent.version, 1);
    const observed = await restored.observeWorld(world.id, { afterSequence: 0 });
    assert.equal(observed.world_state.value.lighthouse.lit, true);
    assert.equal(observed.journey.pet_id, petId);
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM world_build_artifacts WHERE session_id = ?")
        .get(`world-build:${world.id}`).count,
      1,
    );
  } finally {
    await app.close().catch(() => {});
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real journey: official seed refuses same-version content drift", () => {
  const directory = mkdtempSync(join(tmpdir(), "pet-social-official-drift-"));
  const databasePath = join(directory, "social.sqlite");
  const store = new PetSocialStore(databasePath);
  try {
    store.db
      .prepare(`
        UPDATE space_rule_versions
        SET rules_text = '被错误原地修改的官方规则'
        WHERE space_id = 'official-center-town'
          AND version = ?
      `)
      .run(OFFICIAL_WORLD_VERSION);
  } finally {
    store.close();
  }
  try {
    assert.throws(
      () => new PetSocialStore(databasePath),
      /OFFICIAL_WORLD_VERSION_BUMP_REQUIRED/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
