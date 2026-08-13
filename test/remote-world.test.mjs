import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";
import {
  callWorldTool,
  formatWorldCatalog,
  WORLD_CONTENT_SECURITY_NOTICE,
  worldTools
} from "../src/world-tools.mjs";

test("the public catalog never claims a truncated page is complete", () => {
  const catalog = formatWorldCatalog({
    worlds: [{
      id: "world-page-item",
      kind: "user",
      name: "目录页世界",
      description: "用于验证分页诚实性。",
      publication_status: "published",
    }],
    has_more: true,
  });
  assert.equal(catalog.catalog_mode, "public_catalog_page");
  assert.equal(catalog.complete, false);
  assert.equal(catalog.has_more, true);
});

async function registerClient(address, suffix) {
  const registration = await PetSocialClient.register(address.url, {
    recoveryEmail: `${suffix}@example.test`,
    displayName: `pet-${suffix}`
  });
  return {
    registration,
    client: new PetSocialClient({
      serverUrl: address.url,
      token: registration.token
    })
  };
}

async function createPublishedWorld(
  owner,
  {
    resolutionMode = "direct",
    joinPolicy = "open",
    visibility = "public",
    friendPolicy = "enabled"
  } = {}
) {
  const world = await owner.createWorld({
    name: `远程世界-${resolutionMode}`,
    description: "共享认证服务中的 World 运行测试。",
    tags: ["远程", "测试"],
    visibility,
    joinPolicy,
    friendPolicy,
    rulesText: "只修改当前世界内的状态。",
    definitionText: "成员可以探索、建造并留下持久事件。",
    entryPrompt: "说明你准备先做什么。",
    hostPrompt: "只依据当前世界规则结算。",
    resolutionMode,
    initialWorldState: { camp: { wood: 1 } },
    initialMemberState: { role: "owner" }
  });
  return owner.publishWorld(world.id, {
    expectedSpecVersion: 1,
    expectedRuleVersion: 1,
    expectedProfileVersion: 1,
    expectedHostVersion: 1
  });
}

test("SSE replays an offline backlog beyond 500 events completely and in order", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const recipient = await registerClient(address, "sse-backlog");
    const expected = [];
    for (let index = 0; index < 505; index += 1) {
      expected.push(store.createEvent(recipient.registration.pet.id, "test.backlog", { index }));
    }
    const controller = new AbortController();
    const received = [];
    try {
      for await (const event of recipient.client.events(0, controller.signal)) {
        received.push(event);
        if (received.length === expected.length) controller.abort();
      }
    } catch (error) {
      assert.equal(error.name, "AbortError");
    }
    assert.deepEqual(received.map((event) => event.sequence), expected.map((event) => event.id));
    assert.deepEqual(received.map((event) => event.payload.index), [...Array(505).keys()]);
  } finally {
    await app.close();
  }
});

test("shared authenticated clients run a direct world through HTTP", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "world-owner");
    const visitor = await registerClient(address, "world-visitor");
    const world = await createPublishedWorld(owner.client);

    const discovery = await visitor.client.worlds("远程世界");
    assert.equal(discovery.worlds.some((item) => item.id === world.id), true);
    const mcpDiscovery = await callWorldTool(
      visitor.client,
      "world_search",
      { query: "远程世界" }
    );
    assert.equal(
      mcpDiscovery.security_notice,
      WORLD_CONTENT_SECURITY_NOTICE
    );
    assert.equal(
      mcpDiscovery.worlds.some((item) => item.id === world.id),
      true
    );
    assert.equal(mcpDiscovery.catalog_mode, "search_results");
    assert.equal("definition_text" in mcpDiscovery.worlds[0], false);
    await visitor.client.joinWorld(world.id, { ruleVersion: 1 });
    const entered = await visitor.client.enterWorld(world.id, {
      clientSessionId: "codex-thread-world-visitor"
    });
    assert.equal(entered.world.world_agent.role, "host");
    assert.equal(entered.world.world_agent.runtime_role, "referee");
    assert.deepEqual(entered.world.world_agent.capabilities, [
      "guide",
      "inhabit",
      "facilitate",
      "coordinate",
      "judge",
      "advance",
      "remember",
      "recap"
    ]);
    assert.equal(entered.host_guidance.kind, "welcome");
    assert.equal(entered.host_guidance.stage, "setup");
    assert.equal(entered.session.client_session_id, "codex-thread-world-visitor");
    const present = await callWorldTool(
      visitor.client,
      "world_present",
      { world_id: world.id }
    );
    assert.deepEqual(
      present.pets.map((pet) => ({
        id: pet.id,
        is_self: pet.is_self
      })),
      [{ id: visitor.registration.pet.id, is_self: true }]
    );

    const first = await visitor.client.actInWorld(world.id, {
      eventType: "build",
      bodyText: "我搭起一个挡雨棚。",
      proposedWorldStatePatch: { camp: { wood: 3, shelter: true } },
      proposedMemberStatePatch: { role: "builder" },
      expectedWorldStateVersion: 1,
      expectedMemberStateVersion: 1,
      idempotencyKey: "remote-build-1"
    });
    assert.equal(first.status, "accepted");
    assert.equal(first.judgement.world_agent_id, entered.world.world_agent.id);
    assert.deepEqual(first.world_state.value, {
      camp: { wood: 3, shelter: true }
    });
    assert.equal(first.member_state.value.role, "builder");
    const storedInput = store.db
      .prepare("SELECT * FROM world_inputs WHERE id = ?")
      .get(first.input.id);
    assert.equal(storedInput.actor_pet_id, visitor.registration.pet.id);
    assert.equal(storedInput.principal_user_id, visitor.registration.owner.id);
    const storedSession = store.db
      .prepare("SELECT * FROM world_sessions WHERE id = ?")
      .get(entered.session.id);
    assert.equal(storedSession.principal_user_id, visitor.registration.owner.id);

    const speech = await visitor.client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "今晚大家在挡雨棚碰面吧。",
      principalUserId: "spoofed-owner",
      idempotencyKey: "remote-speech-1"
    });
    assert.equal(speech.input.input_type, "speech");
    assert.equal(speech.judgement.decision, "accepted");
    assert.equal(
      store.db
        .prepare("SELECT principal_user_id FROM world_inputs WHERE id = ?")
        .get(speech.input.id).principal_user_id,
      visitor.registration.owner.id
    );

    const retried = await visitor.client.actInWorld(world.id, {
      eventType: "build",
      bodyText: "我搭起一个挡雨棚。",
      proposedWorldStatePatch: { camp: { wood: 3, shelter: true } },
      proposedMemberStatePatch: { role: "builder" },
      expectedWorldStateVersion: 1,
      expectedMemberStateVersion: 1,
      idempotencyKey: "remote-build-1"
    });
    assert.equal(retried.world_state.version, 2);

    await assert.rejects(
      () => visitor.client.actInWorld(world.id, {
        eventType: "build",
        bodyText: "重试不应重复修改。",
        proposedWorldStatePatch: { camp: { wood: 99 } },
        expectedWorldStateVersion: 1,
        idempotencyKey: "remote-build-1"
      }),
      (error) => error?.code === "IDEMPOTENCY_CONFLICT",
    );

    const observed = await owner.client.observeWorld(world.id, {
      afterSequence: 0
    });
    assert.ok(observed.events.some((event) => event.event_class === "intent"));
    assert.ok(observed.events.some((event) => event.event_class === "outcome"));
    assert.equal(observed.world_state.value.camp.shelter, true);
  } finally {
    await app.close();
    store.close();
  }
});

test("a configured owner can host official worlds without gaining content administration", async () => {
  const store = new PetSocialStore();
  const operator = store.register({
    recoveryEmail: "official-host-operator@example.test",
    displayName: "official-host-operator"
  });
  const visitor = store.register({
    recoveryEmail: "official-host-visitor@example.test",
    displayName: "official-host-visitor"
  });
  const app = createPetSocialApp({
    store,
    officialHostOwnerIds: [operator.owner.id]
  });
  const address = await app.listen();
  const operatorClient = new PetSocialClient({
    serverUrl: address.url,
    token: operator.token
  });
  const visitorClient = new PetSocialClient({
    serverUrl: address.url,
    token: visitor.token
  });
  const worldId = "official-center-town";

  try {
    const world = await operatorClient.world(worldId);
    await operatorClient.joinWorld(worldId, {
      ruleVersion: world.rule_version
    });
    await operatorClient.enterWorld(worldId, {
      clientSessionId: "official-host-operator-session"
    });
    await visitorClient.joinWorld(worldId, {
      ruleVersion: world.rule_version
    });
    const visitorEntry = await visitorClient.enterWorld(worldId, {
      clientSessionId: "official-host-visitor-session"
    });

    const operatorRuntime = await operatorClient.worldHostRuntime(worldId);
    assert.equal(operatorRuntime.runtime.creator_takeover_available, true);
    const visitorRuntime = await visitorClient.worldHostRuntime(worldId);
    assert.equal(visitorRuntime.runtime.creator_takeover_available, false);

    await assert.rejects(
      () =>
        operatorClient.updateWorldHost(worldId, {
          expectedVersion: world.world_agent.version,
          name: "不应允许修改"
        }),
      (error) => error.status === 403 && error.code === "FORBIDDEN"
    );
    await assert.rejects(
      () =>
        visitorClient.takeoverWorldHost(worldId, {
          clientSessionId: "official-host-visitor-session"
        }),
      (error) => error.status === 403 && error.code === "FORBIDDEN"
    );

    const claimed = await operatorClient.takeoverWorldHost(worldId, {
      clientSessionId: "official-host-operator-session"
    });
    assert.equal(claimed.runtime.active_executor, "creator_codex");
    assert.equal(claimed.runtime.is_current_executor, true);

    const pending = await visitorClient.submitWorldInput(worldId, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "用于验证官方 Host 的完整裁决链路。",
      observedWorldStateVersion: visitorEntry.state_version,
      observedMemberStateVersion: visitorEntry.member_state_version,
      idempotencyKey: "official-host-resolution"
    });
    assert.equal(pending.status, "pending");
    const next = await operatorClient.nextWorldHostInput(worldId, {
      clientSessionId: "official-host-operator-session"
    });
    assert.equal(next.input.id, pending.input.id);
    const resolved = await operatorClient.resolveWorldHostInput(
      worldId,
      next.input.id,
      {
        clientSessionId: "official-host-operator-session",
        decision: "accepted",
        outcomeText: "官方 Host 已完成这次测试裁决。",
        expectedWorldStateVersion: next.world_state.version,
        applyProposedState: false
      }
    );
    assert.equal(resolved.status, "accepted");
    assert.equal(resolved.judgement.decision_source, "creator_review");

    const released = await operatorClient.releaseWorldHost(worldId, {
      clientSessionId: "official-host-operator-session"
    });
    assert.equal(released.runtime.active_executor, "platform");
  } finally {
    await app.close();
    store.close();
  }
});

test("an authenticated creator can publish, close, reopen, and delete a World", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "life-owner");
    const visitor = await registerClient(address, "life-visitor");
    const draft = await owner.client.createWorld({
      name: "HTTP 生命周期测试岛",
      description: "验证普通用户完整管理自己 World 的流程。",
      rulesText: "尊重现场成员，不替其他宠物行动。",
      definitionText: "成员通过短回合共同修建一座会持续变化的小岛。"
    });
    assert.equal(draft.publication_status, "draft");

    const published = await owner.client.publishWorld(draft.id, {
      expectedSpecVersion: draft.spec_version,
      expectedRuleVersion: draft.rule_version,
      expectedProfileVersion: draft.profile_version,
      expectedHostVersion: draft.world_agent.version
    });
    assert.equal(published.publication_status, "published");
    assert.equal(
      (await visitor.client.worlds("HTTP 生命周期测试岛")).worlds[0].id,
      draft.id
    );
    await visitor.client.joinWorld(draft.id, {
      ruleVersion: draft.rule_version
    });
    await visitor.client.enterWorld(draft.id, {
      clientSessionId: "http-world-lifecycle-visitor"
    });

    const closed = await owner.client.closeWorld(draft.id);
    assert.equal(closed.publication_status, "closed");
    assert.equal(
      (await visitor.client.worlds("HTTP 生命周期测试岛")).worlds.length,
      0
    );
    await assert.rejects(
      () =>
        visitor.client.enterWorld(draft.id, {
          clientSessionId: "http-world-lifecycle-visitor"
        }),
      (error) =>
        error.status === 409 && error.code === "WORLD_NOT_PUBLISHED"
    );

    const reopened = await owner.client.publishWorld(draft.id, {
      expectedSpecVersion: draft.spec_version,
      expectedRuleVersion: draft.rule_version,
      expectedProfileVersion: draft.profile_version,
      expectedHostVersion: draft.world_agent.version
    });
    assert.equal(reopened.publication_status, "published");
    await owner.client.closeWorld(draft.id);
    await assert.rejects(
      () => owner.client.deleteWorld(draft.id, { confirmed: false }),
      (error) =>
        error.status === 400 && error.code === "CONFIRMATION_REQUIRED"
    );
    const deleted = await owner.client.deleteWorld(draft.id, {
      confirmed: true
    });
    assert.equal(deleted.deleted, true);
    await assert.rejects(
      () => owner.client.world(draft.id),
      (error) => error.status === 404 && error.code === "NOT_FOUND"
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("the shared MCP registry exposes the complete World runtime surface", () => {
  const names = new Set(worldTools.map((tool) => tool.name));
  for (const name of [
    "world_search",
    "world_get",
    "world_builder_templates",
    "world_builder_start",
    "world_builder_get",
    "world_builder_update",
    "world_builder_materialize",
    "world_builder_refinement",
    "world_host_get",
    "world_host_update",
    "world_create_simple",
    "world_create",
    "world_update",
    "world_publish",
    "world_close",
    "world_delete",
    "world_list_mine",
    "world_visit",
    "world_join",
    "world_rules_accept",
    "world_admin_add",
    "world_admin_remove",
    "world_share_create",
    "world_share_open",
    "world_invitation_create",
    "world_invitation_list",
    "world_join_request_list",
    "world_join_request_respond",
    "world_enter",
    "world_observe",
    "world_say",
    "world_input_submit",
    "world_input_result",
    "world_act",
    "world_intent_resolve",
    "world_events_ack",
    "world_delegation_set",
    "world_trigger_create",
    "world_trigger_list",
    "world_trigger_cancel"
  ]) {
    assert.equal(names.has(name), true, `missing shared MCP tool: ${name}`);
  }
  const worldSay = worldTools.find((tool) => tool.name === "world_say");
  assert.ok(worldSay.inputSchema.properties.scene_id);
});

test("offline World members receive durable directed speech with monotonic receipts", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "dir-owner");
    const target = await registerClient(address, "dir-target");
    const outsider = await registerClient(address, "dir-out");
    const world = await createPublishedWorld(owner.client);
    await target.client.joinWorld(world.id, { ruleVersion: world.rule_version });
    await target.client.enterWorld(world.id, { clientSessionId: "target-temporary" });
    await target.client.leaveWorld(world.id);

    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS count FROM presence WHERE pet_id = ?")
        .get(target.registration.pet.id).count,
      0,
    );
    const spoken = await callWorldTool(owner.client, "world_say", {
      world_id: world.id,
      target_character_id: target.registration.pet.id,
      body_text: "我把桥边的调查结果留给你，回来后可以从旧木桩继续。",
      idempotency_key: "directed-offline-world-speech",
      confirmed: true,
    });
    assert.equal(spoken.status, "accepted");
    assert.equal(spoken.delivery.world_write, "written");
    assert.equal(spoken.delivery.target_delivery_state, "queued");
    assert.ok(spoken.delivery.notification_event_id);

    const repeatedSpeech = await callWorldTool(owner.client, "world_say", {
      world_id: world.id,
      target_character_id: target.registration.pet.id,
      body_text: "我把桥边的调查结果留给你，回来后可以从旧木桩继续。",
      idempotency_key: "directed-offline-world-speech",
      confirmed: true,
    });
    assert.equal(
      repeatedSpeech.delivery.notification_event_id,
      spoken.delivery.notification_event_id,
    );
    assert.equal(
      store.db.prepare(`
        SELECT COUNT(*) AS count FROM events
        WHERE pet_id = ? AND event_type = 'world.event_committed'
          AND json_extract(payload_json, '$.inputId') = ?
      `).get(target.registration.pet.id, spoken.input.id).count,
      1,
    );

    const resumed = await target.client.enterWorld(world.id, {
      clientSessionId: "target-resumed-with-relevant-updates",
    });
    const resumedUpdate = resumed.resume_bundle.relevant_updates.find(
      (item) => item.event_id === spoken.delivery.notification_event_id,
    );
    assert.ok(resumedUpdate);
    assert.equal(resumedUpdate.relevance, "direct");
    assert.equal(resumedUpdate.action_required, true);
    assert.match(resumedUpdate.summary, /桥边|调查结果|旧木桩/u);

    const friendship = await owner.client.sendFriendRequest(target.registration.pet.id);
    await target.client.respondFriendRequest(friendship.friendship.id, "accept");
    const privateMessage = await owner.client.sendMessage({
      target: target.registration.pet.id,
      text: "私信补充：地图背面还有一行坐标。",
    });

    const activity = await target.client.activity();
    const worldItem = activity.items.find(
      (item) => item.eventId === spoken.delivery.notification_event_id,
    );
    assert.equal(worldItem.channel, "world");
    assert.equal(worldItem.targetCharacterId, target.registration.pet.id);
    assert.equal(worldItem.reply.available, true);
    assert.equal(worldItem.reply.tool, "world_say");
    assert.equal(worldItem.delivery.state, "queued");
    assert.equal(worldItem.relevance, "direct");
    assert.equal(worldItem.relevanceReason, "directed_speech_target");
    assert.equal(worldItem.deliveryPolicy, "action_required");
    assert.equal(worldItem.actionRequired, true);
    assert.match(worldItem.summary, /桥边|调查结果|旧木桩/u);
    const privateItem = activity.items.find(
      (item) => item.channel === "private_message" && item.messageId === privateMessage.message.id,
    );
    assert.ok(privateItem);
    assert.match(privateItem.summary, /地图背面|坐标/u);
    await assert.rejects(
      target.client.markEventReceipt(privateItem.eventId, "read"),
      (error) => error.code === "DISPLAY_REQUIRED",
    );
    await target.client.markEventReceipt(privateItem.eventId, "delivered");
    await target.client.markEventReceipt(privateItem.eventId, "displayed");
    await target.client.markEventReceipt(privateItem.eventId, "read");
    assert.equal(
      (await target.client.activity()).items.find((item) => item.eventId === privateItem.eventId)
        .delivery.state,
      "read",
    );
    assert.equal(
      store.db.prepare("SELECT status FROM messages WHERE id = ?").get(privateMessage.message.id).status,
      "read",
    );

    await target.client.markEventReceipt(worldItem.eventId, "delivered");
    assert.equal(
      (await target.client.activity()).items.find((item) => item.eventId === worldItem.eventId)
        .delivery.state,
      "delivered",
    );
    await target.client.markEventReceipt(worldItem.eventId, "displayed");
    await target.client.markEventReceipt(worldItem.eventId, "read");
    assert.equal(
      (await target.client.activity()).items.find((item) => item.eventId === worldItem.eventId)
        .delivery.state,
      "read",
    );
    const senderWorldItem = (await owner.client.activity()).items.find(
      (item) => item.outcomeEventId === spoken.outcome.id,
    );
    assert.equal(senderWorldItem.relevance, "self");
    assert.equal(senderWorldItem.relevanceReason, "own_action_result");
    assert.equal(senderWorldItem.deliveryPolicy, "digest");
    assert.equal(senderWorldItem.actionRequired, false);
    assert.equal(senderWorldItem.delivery.state, "queued");

    const observed = await callWorldTool(target.client, "world_observe", {
      world_id: world.id,
      after_sequence: 0,
    });
    assert.ok(observed.events.some((event) => event.id === spoken.outcome.id));
    assert.equal(
      (await outsider.client.activity()).items.some(
        (item) => item.world?.id === world.id,
      ),
      false,
    );

    const refreshed = await owner.client.worldInputResult(world.id, spoken.input.id, {
      waitMs: 0,
    });
    assert.equal(refreshed.delivery.target_delivery_state, "read");
  } finally {
    await app.close();
    store.close();
  }
});

test("the simple MCP flow publishes an open hidden World addressable by ID", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "simple-world-owner");
    const visitor = await registerClient(address, "simple-world-visitor");
    const before = await owner.client.myWorlds();
    await assert.rejects(
      () => callWorldTool(owner.client, "world_create_simple", {
        name: "不应创建",
        rules_text: "没有明确确认时不得创建或发布。",
        visibility: "hidden",
        confirmed: false,
      }),
      (error) => error.code === "CONFIRMATION_REQUIRED",
    );
    await assert.rejects(
      () => callWorldTool(owner.client, "world_create_simple", {
        name: "同样不应创建",
        rules_text: "缺少确认也不得创建或发布。",
        visibility: "hidden",
      }),
      (error) => error.code === "CONFIRMATION_REQUIRED",
    );
    assert.equal((await owner.client.myWorlds()).worlds.length, before.worlds.length);
    const created = await callWorldTool(owner.client, "world_create_simple", {
      name: "暗门之后",
      rules_text: "知道世界 ID 的角色可以进入；不能替其他角色作决定。",
      visibility: "hidden",
      confirmed: true,
    });
    assert.equal(created.world.publication_status, "published");
    assert.equal(created.join_policy, "open");
    assert.equal(created.discovery, "exact_world_id_only");
    assert.equal(
      (await callWorldTool(visitor.client, "world_search", {
        query: "暗门之后",
      })).worlds.length,
      0,
    );
    const exact = await callWorldTool(visitor.client, "world_search", {
      query: created.world_id,
    });
    assert.equal(exact.worlds[0].id, created.world_id);
    const visited = await callWorldTool(visitor.client, "world_visit", {
      world_id: created.world_id,
      confirmed: true,
      confirmed_rule_version: exact.worlds[0].rule_version,
    });
    assert.equal(visited.status, "entered");
    assert.equal(visited.membership.status, "active");

    const action = await callWorldTool(visitor.client, "world_act", {
      world_id: created.world_id,
      body_text: "我先在门口看看周围。",
      idempotency_key: "hidden-simple-world-first-action",
    });
    assert.equal(action.status, "accepted");
  } finally {
    await app.close();
    store.close();
  }
});

test("standard MCP visit carries an invitation and never invents an action retry key", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "std-invite-owner");
    const visitor = await registerClient(address, "std-invite-visitor");
    const friendship = await owner.client.sendFriendRequest(visitor.registration.pet.id);
    await visitor.client.respondFriendRequest(friendship.friendship.id, "accept");
    const world = await createPublishedWorld(owner.client, { joinPolicy: "approval" });
    const invitation = await owner.client.createWorldInvitation(world.id, {
      targetPetId: visitor.registration.pet.id,
      bypassApproval: true,
    });

    const visitTool = worldTools.find((tool) => tool.name === "world_visit");
    assert.ok(visitTool.inputSchema.properties.invitation_id);
    const listed = await callWorldTool(visitor.client, "world_invitation_list");
    assert.equal(listed.invitations[0].id, invitation.id);
    const entered = await callWorldTool(visitor.client, "world_visit", {
      world_id: world.id,
      confirmed: true,
      confirmed_rule_version: world.rule_version,
      invitation_id: invitation.id,
    });
    assert.equal(entered.status, "entered");
    assert.equal(entered.membership.status, "active");

    await assert.rejects(
      () => callWorldTool(visitor.client, "world_act", {
        world_id: world.id,
        body_text: "我检查码头的旧灯。",
      }),
      (error) => error?.code === "MISSING_IDEMPOTENCY_KEY",
    );
    const action = await callWorldTool(visitor.client, "world_act", {
      world_id: world.id,
      body_text: "我检查码头的旧灯。",
      idempotency_key: "standard-invited-action",
    });
    const replay = await callWorldTool(visitor.client, "world_act", {
      world_id: world.id,
      body_text: "我检查码头的旧灯。",
      idempotency_key: "standard-invited-action",
    });
    assert.equal(replay.input.id, action.input.id);
  } finally {
    await app.close();
    store.close();
  }
});

test("shared MCP creates a world and Host through the World Builder Agent", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "world-builder-owner");
    const templates = await callWorldTool(
      owner.client,
      "world_builder_templates"
    );
    assert.equal(templates.platform_agent.id, "platform-world-builder");
    assert.ok(
      templates.templates.some((item) => item.id === "quest-director")
    );

    const started = await callWorldTool(owner.client, "world_builder_start", {
      brief_text: "宠物们在浮空列车上共同推进一段连续冒险。",
      template_id: "quest-director"
    });
    assert.equal(started.status, "draft");
    const artifact = started.artifact;
    artifact.world.name = "浮空列车";
    artifact.world.rulesText =
      "不替其他角色决定；冲突必须交给本世界主持处理。";
    const updated = await callWorldTool(
      owner.client,
      "world_builder_update",
      {
        build_id: started.id,
        expected_version: started.version,
        artifact
      }
    );
    assert.equal(updated.status, "validated");
    const materialized = await callWorldTool(
      owner.client,
      "world_builder_materialize",
      {
        build_id: updated.id,
        expected_version: updated.version,
        confirmed: true
      }
    );
    assert.equal(materialized.world.publication_status, "draft");
    assert.equal(
      materialized.world.world_agent.created_by_agent_id,
      "platform-world-builder"
    );
    const storedBuild = store.db
      .prepare("SELECT * FROM world_build_sessions WHERE id = ?")
      .get(started.id);
    assert.equal(storedBuild.principal_user_id, owner.registration.owner.id);
    assert.equal(storedBuild.world_id, materialized.world.id);
  } finally {
    await app.close();
    store.close();
  }
});

test("managed worlds queue remote actions and enforce manager resolution", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "managed-owner");
    const visitor = await registerClient(address, "managed-visitor");
    const world = await createPublishedWorld(owner.client, {
      resolutionMode: "managed"
    });
    await visitor.client.joinWorld(world.id, { ruleVersion: 1 });

    const pending = await visitor.client.actInWorld(world.id, {
      eventType: "explore",
      bodyText: "我沿着河流寻找水源。",
      proposedWorldStatePatch: { springFound: true },
      proposedMemberStatePatch: { role: "explorer" },
      idempotencyKey: "remote-explore-1"
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.host_guidance.kind, "waiting");

    await assert.rejects(
      () =>
        visitor.client.resolveWorldIntent(world.id, pending.intent.id, {
          decision: "accepted"
        }),
      (error) => error.status === 403 && error.code === "FORBIDDEN"
    );

    const ownerView = await owner.client.observeWorld(world.id);
    assert.equal(ownerView.pending_intents.length, 1);
    const resolved = await owner.client.resolveWorldIntent(
      world.id,
      pending.intent.id,
      {
        decision: "accepted",
        outcomeText: "在河湾旁找到了清澈泉水。",
        expectedWorldStateVersion: 1,
        expectedMemberStateVersion: 1
      }
    );
    assert.equal(resolved.status, "accepted");
    assert.equal(resolved.host_guidance.kind, "progress");
    assert.equal(resolved.world_state.value.springFound, true);
    assert.equal(resolved.member_state.value.role, "explorer");
  } finally {
    await app.close();
    store.close();
  }
});

test("shared worlds preserve approval, share, invitation, and rule boundaries", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "boundary-owner");
    const visitor = await registerClient(address, "boundary-visitor");

    const approval = await createPublishedWorld(owner.client, {
      joinPolicy: "approval"
    });
    const application = await visitor.client.joinWorld(approval.id, {
      ruleVersion: 1,
      applicationText: "希望参与长期共建。"
    });
    assert.equal(application.membership.status, "pending");
    const requests = await owner.client.worldJoinRequests(approval.id);
    assert.equal(requests.requests.length, 1);
    const accepted = await owner.client.respondWorldJoinRequest(
      approval.id,
      visitor.registration.pet.id,
      { decision: "accepted" }
    );
    assert.equal(accepted.status, "active");

    const unlisted = await createPublishedWorld(owner.client, {
      visibility: "unlisted"
    });
    await assert.rejects(
      () => visitor.client.joinWorld(unlisted.id, { ruleVersion: 1 }),
      (error) => error.status === 403 && error.code === "SHARE_REQUIRED"
    );
    const share = await owner.client.createWorldShare(unlisted.id, {
      expiresInDays: 7
    });
    const sharedView = await visitor.client.openWorldShare(share.token);
    assert.equal(sharedView.world.id, unlisted.id);
    const sharedJoin = await visitor.client.joinWorld(unlisted.id, {
      ruleVersion: 1,
      shareToken: share.token
    });
    assert.equal(sharedJoin.membership.status, "active");

    const friendship = await owner.client.sendFriendRequest(
      visitor.registration.pet.id
    );
    await visitor.client.respondFriendRequest(
      friendship.friendship.id,
      "accept"
    );
    const hidden = await createPublishedWorld(owner.client, {
      visibility: "hidden",
      joinPolicy: "invite_only"
    });
    const invitation = await owner.client.createWorldInvitation(hidden.id, {
      targetPetId: visitor.registration.pet.id,
      bypassApproval: true
    });
    const invitations = await visitor.client.worldInvitations();
    assert.equal(
      invitations.invitations.some((item) => item.id === invitation.id),
      true
    );
    const invitedJoin = await visitor.client.joinWorld(hidden.id, {
      ruleVersion: 1,
      invitationId: invitation.id
    });
    assert.equal(invitedJoin.membership.status, "active");

    const pathBoundUpdate = await owner.client.request(
      `/v1/worlds/${encodeURIComponent(hidden.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          worldId: approval.id,
          expectedVersion: 1,
          expectedProfileVersion: 1,
          name: "隐藏世界路径绑定"
        })
      }
    );
    assert.equal(pathBoundUpdate.id, hidden.id);
    assert.notEqual(
      (await owner.client.world(approval.id)).name,
      "隐藏世界路径绑定"
    );

    const changed = await owner.client.updateWorld(hidden.id, {
      expectedVersion: 1,
      friendPolicy: "disabled"
    });
    assert.equal(changed.spec_version, 2);
    const reruled = await owner.client.updateWorld(hidden.id, {
      expectedVersion: 2,
      expectedRuleVersion: 1,
      rulesText: "新规则需要所有成员重新确认。"
    });
    assert.equal(reruled.rule_version, 2);
    const staleVisit = await callWorldTool(visitor.client, "world_visit", {
      world_id: hidden.id,
      confirmed: true,
      confirmed_rule_version: 1,
    });
    assert.equal(staleVisit.status, "rules_changed");
    assert.equal(staleVisit.required_rule_version, 2);
    assert.equal(staleVisit.membership.accepted_rule_version, 1);
    await assert.rejects(
      () =>
        visitor.client.actInWorld(hidden.id, {
          bodyText: "在旧规则下行动。",
          idempotencyKey: "stale-remote-rules"
        }),
      (error) =>
        error.status === 409 && error.code === "RULE_VERSION_MISMATCH"
    );
    const acceptedVisit = await callWorldTool(visitor.client, "world_visit", {
      world_id: hidden.id,
      confirmed: true,
      confirmed_rule_version: 2,
    });
    assert.equal(acceptedVisit.status, "entered");
    assert.equal(acceptedVisit.membership.accepted_rule_version, 2);
  } finally {
    await app.close();
    store.close();
  }
});
