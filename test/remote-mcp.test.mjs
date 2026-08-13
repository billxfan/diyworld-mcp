import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { CLIENT_PACKAGE_VERSION } from "../src/release.mjs";
import { OFFICIAL_WORLDS } from "../src/venue-lab-core/official-worlds.js";
import { PetSocialStore } from "../src/store.mjs";

async function callMcp(url, token, message, headers = {}) {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(message)
  });
  return { response, body: await response.json() };
}

test("the Tunnel-ready remote MCP exposes a concise authenticated tool surface", async () => {
  const app = createPetSocialApp({ inviteRequired: false });
  const address = await app.listen();
  try {
    const registration = await PetSocialClient.register(address.url, {
      recoveryEmail: "remote-mcp@example.test",
      displayName: "远程 MCP 测试者",
      deviceName: "Remote MCP test",
      agentProvider: "other"
    });

    const initialized = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" }
    });
    assert.equal(initialized.response.status, 200);
    assert.equal(initialized.body.result.serverInfo.name, "diyworld");
    assert.equal(initialized.body.result.serverInfo.version, CLIENT_PACKAGE_VERSION);
    assert.match(initialized.body.result.instructions, /world_search once without query/u);
    assert.match(initialized.body.result.instructions, /without requiring the person to type a “check messages” command/u);
    assert.match(initialized.body.result.instructions, /resume_bundle and loop_context/u);

    const listed = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    const names = new Set(listed.body.result.tools.map((tool) => tool.name));
    assert.ok(names.has("world_search"));
    assert.ok(names.has("world_visit"));
    assert.ok(names.has("world_act"));
    assert.ok(names.has("world_get"));
    assert.ok(names.has("world_input_result"));
    assert.ok(names.has("profile_get"));
    assert.ok(names.has("profile_update"));
    assert.ok(names.has("people_discover"));
    for (const name of [
      "agent_binding_get",
      "agent_binding_list",
      "agent_binding_revoke",
      "friend_request_send",
      "friend_request_list",
      "friend_request_respond",
      "friend_remove",
      "message_mark_read",
      "activity_list",
      "activity_mark_read",
      "world_create_simple",
      "world_list_mine",
      "world_observe",
      "world_say",
    ]) {
      assert.ok(names.has(name), name);
    }
    assert.equal(names.has("character_get"), false);
    assert.equal(names.has("pet_get"), false);
    assert.equal(names.has("world_input_submit"), false);
    const worldSearch = listed.body.result.tools.find(
      (tool) => tool.name === "world_search",
    );
    assert.match(worldSearch.description, /必须省略 query/u);
    const updateProfile = listed.body.result.tools.find(
      (tool) => tool.name === "profile_update",
    );
    assert.equal("form" in updateProfile.inputSchema.properties, false);
    assert.equal("appearance" in updateProfile.inputSchema.properties, false);
    const worldVisit = listed.body.result.tools.find(
      (tool) => tool.name === "world_visit",
    );
    const worldObserve = listed.body.result.tools.find(
      (tool) => tool.name === "world_observe",
    );
    const worldAct = listed.body.result.tools.find(
      (tool) => tool.name === "world_act",
    );
    const messageSend = listed.body.result.tools.find(
      (tool) => tool.name === "message_send",
    );
    const worldSay = listed.body.result.tools.find(
      (tool) => tool.name === "world_say",
    );
    assert.match(worldVisit.description, /前台剧情 Loop/u);
    assert.match(worldObserve.description, /不应要求用户手动/u);
    assert.match(worldAct.description, /相关未读变化/u);
    assert.deepEqual(messageSend.inputSchema.required, ["target", "text", "confirmed"]);
    assert.equal(messageSend.inputSchema.properties.confirmed.const, true);
    assert.deepEqual(worldSay.inputSchema.required, [
      "world_id",
      "target_character_id",
      "body_text",
      "idempotency_key",
      "confirmed",
    ]);
    assert.equal(worldSay.inputSchema.properties.confirmed.const, true);
    assert.ok(worldVisit.inputSchema.properties.invitation_id);
    assert.ok(worldAct.inputSchema.required.includes("idempotency_key"));

    const missingActionKey = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: {
        name: "world_act",
        arguments: { world_id: "anywhere", body_text: "不应在重试时被重复提交。" },
      },
    });
    assert.equal(missingActionKey.body.result.isError, true);
    assert.equal(
      missingActionKey.body.result.structuredContent.error.code,
      "MISSING_IDEMPOTENCY_KEY",
    );
    assert.match(
      missingActionKey.body.result.structuredContent.error.guidance,
      /stable key|稳定/u,
    );

    const profile = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "profile_get", arguments: {} }
    });
    assert.equal(profile.body.result.isError, false);
    assert.equal(profile.body.result.structuredContent.profile.name, "远程 MCP 测试者");
    assert.equal("form" in profile.body.result.structuredContent.profile, false);

    const rejectedCreation = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "world_create_simple",
        arguments: {
          name: "未经确认的世界",
          rules_text: "这个调用必须被服务端拒绝。",
          visibility: "public",
          confirmed: false,
        },
      },
    });
    assert.equal(rejectedCreation.body.result.isError, true);
    assert.match(
      rejectedCreation.body.result.content[0].text,
      /CONFIRMATION_REQUIRED|explicit confirmation/u,
    );
    assert.equal(
      rejectedCreation.body.result.structuredContent.error.guidance.includes("confirmed:true"),
      true,
    );

    for (const [id, name, arguments_] of [
      [32, "message_send", { target: "anyone", text: "未经确认的私信" }],
      [33, "world_say", {
        world_id: "anywhere",
        target_character_id: "anyone",
        body_text: "未经确认的世界发言",
      }],
    ]) {
      const rejected = await callMcp(address.url, registration.token, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: arguments_ },
      });
      assert.equal(rejected.body.result.isError, true);
      assert.equal(rejected.body.result.structuredContent.error.code, "CONFIRMATION_REQUIRED");
      assert.equal(rejected.body.result.structuredContent.error.retryable, false);
      assert.match(rejected.body.result.structuredContent.error.guidance, /confirmed:true/u);
    }

    const catalog = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "world_search", arguments: {} }
    });
    const catalogValue = catalog.body.result.structuredContent;
    assert.equal(catalogValue.catalog_mode, "complete_public_catalog");
    assert.equal(catalogValue.complete, true);
    assert.deepEqual(
      catalogValue.worlds.map((world) => world.id),
      OFFICIAL_WORLDS.map((world) => world.id),
    );
    assert.ok(catalogValue.worlds.every((world) => !("definition_text" in world)));
    assert.ok(catalogValue.worlds.every((world) => !("host_prompt" in world)));

    const noToken = await fetch(`${address.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" })
    });
    assert.equal(noToken.status, 401);
  } finally {
    await app.close();
  }
});

test("standard MCP paginates every activity page and only acknowledges displayed World events", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const registration = await PetSocialClient.register(address.url, {
      recoveryEmail: "mcp-pagination@example.test",
      displayName: "分页测试者",
    });
    for (let index = 0; index < 101; index += 1) {
      store.createEvent(registration.pet.id, "world.event_committed", {
        worldId: "world-page",
        outcomeText: `update-${index}`,
      });
    }
    const first = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0", id: 41, method: "tools/call",
      params: { name: "activity_list", arguments: { limit: 100 } },
    });
    const firstValue = first.body.result.structuredContent;
    assert.equal(firstValue.items.length, 100);
    assert.equal(firstValue.has_more, true);
    assert.equal(firstValue.complete, false);
    assert.ok(firstValue.next_cursor);
    const second = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0", id: 42, method: "tools/call",
      params: { name: "activity_list", arguments: { limit: 100, before: firstValue.next_cursor } },
    });
    const secondValue = second.body.result.structuredContent;
    assert.equal(secondValue.items.length, 1);
    assert.equal(secondValue.complete, true);
    const all = [...firstValue.items, ...secondValue.items];
    assert.equal(new Set(all.map((item) => item.eventId)).size, 101);
    assert.deepEqual(all.map((item) => item.summary), [...Array(101).keys()].reverse().map((index) => `update-${index}`));

    const senderRegistration = await PetSocialClient.register(address.url, {
      recoveryEmail: "mcp-inbox-sender@example.test", displayName: "收件箱发送者",
    });
    const recipientClient = new PetSocialClient({ serverUrl: address.url, token: registration.token });
    const senderClient = new PetSocialClient({ serverUrl: address.url, token: senderRegistration.token });
    const friendship = await senderClient.sendFriendRequest(registration.pet.id);
    await recipientClient.respondFriendRequest(friendship.friendship.id, "accept");
    for (let index = 0; index < 6; index += 1) {
      await senderClient.sendMessage({ target: registration.pet.id, text: `message-${index}` });
    }
    const inboxFirst = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0", id: 47, method: "tools/call",
      params: { name: "inbox_list", arguments: { limit: 5 } },
    });
    const inboxFirstValue = inboxFirst.body.result.structuredContent;
    assert.equal(inboxFirstValue.messages.length, 5);
    assert.equal(inboxFirstValue.has_more, true);
    const inboxSecond = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0", id: 48, method: "tools/call",
      params: { name: "inbox_list", arguments: { limit: 5, before: inboxFirstValue.next_cursor } },
    });
    const allMessages = [...inboxFirstValue.messages, ...inboxSecond.body.result.structuredContent.messages];
    assert.equal(inboxSecond.body.result.structuredContent.complete, true);
    assert.equal(new Set(allMessages.map((message) => message.id)).size, 6);
    assert.deepEqual(allMessages.map((message) => message.text), [...Array(6).keys()].reverse().map((index) => `message-${index}`));

    const owner = await PetSocialClient.register(address.url, {
      recoveryEmail: "mcp-ack-owner@example.test", displayName: "确认创建者",
    });
    const ownerClient = new PetSocialClient({ serverUrl: address.url, token: owner.token });
    const world = await ownerClient.createWorld({
      name: "确认世界", description: "", tags: [], visibility: "public", joinPolicy: "open", friendPolicy: "enabled",
      rulesText: "规则", definitionText: "定义", entryPrompt: "入口", hostPrompt: "裁决", resolutionMode: "direct", initialWorldState: {}, initialMemberState: {},
    });
    const published = await ownerClient.publishWorld(world.id, {
      expectedSpecVersion: 1, expectedRuleVersion: 1, expectedProfileVersion: 1, expectedHostVersion: 1,
    });
    const visitor = await PetSocialClient.register(address.url, {
      recoveryEmail: "mcp-ack-visitor@example.test", displayName: "确认访客",
    });
    const visitorClient = new PetSocialClient({ serverUrl: address.url, token: visitor.token });
    await visitorClient.joinWorld(published.id, { ruleVersion: 1 });
    await visitorClient.enterWorld(published.id);
    const worldAction = await visitorClient.actInWorld(published.id, { bodyText: "我留下一个路标。", idempotencyKey: "ack-page-action" });
    const observed = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 43, method: "tools/call",
      params: { name: "world_observe", arguments: { world_id: published.id, after_sequence: 0, limit: 3 } },
    });
    const observedValue = observed.body.result.structuredContent;
    assert.ok(observedValue.events.length > 0);
    const undisplayed = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 44, method: "tools/call",
      params: { name: "world_events_ack", arguments: { world_id: published.id, after_sequence: observedValue.displayed_range.after_sequence, through_sequence: observedValue.cursor } },
    });
    assert.equal(undisplayed.body.result.isError, true);
    assert.equal(undisplayed.body.result.structuredContent.error.code, "DISPLAY_REQUIRED");
    const fabricatedThrough = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 54, method: "tools/call",
      params: { name: "world_events_ack", arguments: {
        world_id: published.id,
        after_sequence: observedValue.displayed_range.after_sequence,
        through_sequence: observedValue.latest_sequence + 1,
        displayed: true,
      } },
    });
    assert.equal(fabricatedThrough.body.result.isError, true);
    assert.equal(fabricatedThrough.body.result.structuredContent.error.code, "INVALID_CURSOR");
    const skippedPageStart = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 55, method: "tools/call",
      params: { name: "world_events_ack", arguments: {
        world_id: published.id,
        after_sequence: 2,
        through_sequence: 3,
        displayed: true,
      } },
    });
    assert.equal(skippedPageStart.body.result.isError, true);
    assert.equal(skippedPageStart.body.result.structuredContent.error.code, "INVALID_CURSOR");
    const afterRejectedAcks = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 56, method: "tools/call",
      params: { name: "world_observe", arguments: { world_id: published.id } },
    });
    assert.equal(afterRejectedAcks.body.result.structuredContent.membership.last_seen_event_sequence, 0);
    const stillQueuedAfterRejectedAcks = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 57, method: "tools/call",
      params: { name: "activity_list", arguments: {} },
    });
    assert.ok(
      stillQueuedAfterRejectedAcks.body.result.structuredContent.items.some(
        (item) => item.world?.id === published.id && item.outcomeEventId === worldAction.outcome.id && item.delivery.state === "queued",
      ),
    );
    const acknowledged = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 45, method: "tools/call",
      params: { name: "world_events_ack", arguments: { world_id: published.id, after_sequence: observedValue.displayed_range.after_sequence, through_sequence: observedValue.cursor, displayed: true } },
    });
    assert.equal(acknowledged.body.result.isError, false);
    const stillQueued = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 51, method: "tools/call",
      params: { name: "activity_list", arguments: {} },
    });
    assert.ok(
      stillQueued.body.result.structuredContent.items.some(
        (item) => item.world?.id === published.id && item.outcomeEventId === worldAction.outcome.id && item.delivery.state === "queued",
      ),
    );
    const observedSecondPage = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 52, method: "tools/call",
      params: { name: "world_observe", arguments: { world_id: published.id } },
    });
    const observedSecondValue = observedSecondPage.body.result.structuredContent;
    assert.equal(observedSecondValue.events.some((event) => event.id === worldAction.outcome.id), true);
    const acknowledgedSecondPage = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 53, method: "tools/call",
      params: { name: "world_events_ack", arguments: {
        world_id: published.id,
        after_sequence: observedSecondValue.displayed_range.after_sequence,
        through_sequence: observedSecondValue.cursor,
        displayed: true,
      } },
    });
    assert.equal(acknowledgedSecondPage.body.result.isError, false);
    const displayedActivity = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 49, method: "tools/call",
      params: { name: "activity_list", arguments: { include_displayed: true } },
    });
    const matchingNotification = displayedActivity.body.result.structuredContent.items.find(
      (item) => item.world?.id === published.id && item.outcomeEventId === worldAction.outcome.id,
    );
    assert.ok(matchingNotification);
    assert.equal(matchingNotification.delivery.state, "displayed");
    const newActivity = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 50, method: "tools/call",
      params: { name: "activity_list", arguments: {} },
    });
    assert.equal(
      newActivity.body.result.structuredContent.items.some(
        (item) => item.world?.id === published.id && item.outcomeEventId === matchingNotification.outcomeEventId,
      ),
      false,
    );
    const afterAck = await callMcp(address.url, visitor.token, {
      jsonrpc: "2.0", id: 46, method: "tools/call",
      params: { name: "world_observe", arguments: { world_id: published.id } },
    });
    assert.equal(afterAck.body.result.structuredContent.events.length, 0);
  } finally {
    await app.close();
    store.close();
  }
});

test("standard MCP world_visit is a compact player view for every official World and a custom World", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const registration = await PetSocialClient.register(address.url, {
      recoveryEmail: "mcp-player-visit@example.test",
      displayName: "玩家视角访客",
    });
    const client = new PetSocialClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const visit = async (world, id) => {
      const response = await callMcp(address.url, registration.token, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "world_visit",
          arguments: {
            world_id: world.id,
            confirmed: true,
            confirmed_rule_version: world.rule_version,
          },
        },
      });
      assert.equal(response.body.result.isError, false);
      return response.body.result.structuredContent;
    };
    const assertPlayerVisit = (entered, label) => {
      const serialized = JSON.stringify(entered);
      assert.equal(entered.status, "entered", label);
      assert.ok(entered.world.id, label);
      assert.ok(entered.world.rules_text, label);
      assert.ok(entered.host_guidance.message, label);
      assert.ok(entered.host_guidance.objective, label);
      assert.ok(entered.host_guidance.choices.length > 0, label);
      assert.ok(entered.resume_bundle.suggested_actions.length > 0, label);
      assert.ok(serialized.length < 18_000, `${label}: ${serialized.length}`);
      for (const internalKey of [
        "director_plan",
        "loop_transition_contract",
        "state_contract",
        "world_progress",
        "host_prompt",
        "definition_text",
        "world_agent",
        "host_runtime",
        "initialWorldState",
      ]) {
        assert.equal(serialized.includes(internalKey), false, `${label}: ${internalKey}`);
      }
      // Thread IDs and raw state-machine loop identifiers must never become
      // first-visit copy just because the local runtime needs them.
      assert.equal(/(?:thread:|loop:|entry:)[\w:-]+/u.test(serialized), false, label);
    };

    for (const [index, official] of OFFICIAL_WORLDS.entries()) {
      const entered = await visit(await client.world(official.id), 100 + index);
      assertPlayerVisit(entered, official.id);
      const choice = entered.host_guidance.choices[0];
      const action = await callMcp(address.url, registration.token, {
        jsonrpc: "2.0",
        id: 200 + index,
        method: "tools/call",
        params: {
          name: "world_act",
          arguments: {
            world_id: entered.world.id,
            input_type: choice.input_type,
            event_type: choice.event_type,
            body_text: choice.body_text,
            data: choice.data,
            scene_id: choice.scene_id,
            visibility: choice.visibility,
            idempotency_key: `player-projection-official-${index}`,
          },
        },
      });
      assert.equal(
        action.body.result.isError,
        false,
        `${official.id}: ${JSON.stringify(action.body.result.structuredContent)}`,
      );
      assert.ok(action.body.result.structuredContent.input?.id, official.id);
    }

    const custom = await client.createWorld({
      name: "玩家投影自建世界",
      description: "验证普通玩家进入时只看得到可行动的信息。",
      tags: ["测试"],
      visibility: "public",
      joinPolicy: "open",
      friendPolicy: "enabled",
      rulesText: "只能决定自己的行动。",
      definitionText: "码头边的旧信号灯在雨里闪烁。",
      entryPrompt: "雨中的旧信号灯忽明忽暗；你可以检查灯座、询问码头工人，或寻找备用电源。",
      hostPrompt: "根据当前世界事实裁决。",
      resolutionMode: "direct",
      initialWorldState: {
        world_progress: { open_threads: [{ id: "internal-thread-should-not-leak" }] },
      },
      initialMemberState: {},
    });
    const published = await client.publishWorld(custom.id, {
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    const customEntered = await visit(published, 300);
    assertPlayerVisit(customEntered, "custom");
    const customChoice = customEntered.host_guidance.choices[0];
    const customAction = await callMcp(address.url, registration.token, {
      jsonrpc: "2.0",
      id: 301,
      method: "tools/call",
      params: {
        name: "world_act",
        arguments: {
          world_id: customEntered.world.id,
          input_type: customChoice.input_type,
          event_type: customChoice.event_type,
          body_text: customChoice.body_text,
          data: customChoice.data,
          scene_id: customChoice.scene_id,
          visibility: customChoice.visibility,
          idempotency_key: "player-projection-custom",
        },
      },
    });
    assert.equal(customAction.body.result.isError, false);
    assert.ok(customAction.body.result.structuredContent.input?.id);
  } finally {
    await app.close();
    store.close();
  }
});

test("standard MCP world_visit lets an offline member answer a collective invitation from player projection only", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const host = await PetSocialClient.register(address.url, {
      recoveryEmail: "projection-host@example.test", displayName: "投影主持",
    });
    const offline = await PetSocialClient.register(address.url, {
      recoveryEmail: "projection-offline@example.test", displayName: "投影离线成员",
    });
    const hostClient = new PetSocialClient({ serverUrl: address.url, token: host.token });
    const offlineClient = new PetSocialClient({ serverUrl: address.url, token: offline.token });
    const created = await hostClient.createWorld({
      name: "离线回应投影", description: "", tags: [], visibility: "public",
      joinPolicy: "open", friendPolicy: "enabled", rulesText: "只能决定自己。",
      definitionText: "协作决定。", entryPrompt: "选择行动。", hostPrompt: "裁决。",
      resolutionMode: "direct", initialWorldState: { phase: "open" }, initialMemberState: {},
    });
    const world = await hostClient.publishWorld(created.id, {
      expectedSpecVersion: 1, expectedRuleVersion: 1,
      expectedProfileVersion: 1, expectedHostVersion: 1,
    });
    await hostClient.enterWorld(world.id, { clientSessionId: "projection-host" });
    await offlineClient.joinWorld(world.id, { ruleVersion: world.rule_version });
    await hostClient.takeoverWorldHost(world.id, { clientSessionId: "projection-host" });
    const opened = await hostClient.openWorldHostInteraction(world.id, {
      clientSessionId: "projection-host",
      promptText: "要打开水闸吗？",
      mode: "windowed",
      windowSeconds: 120,
      choiceOptions: [{ choice_id: "open_gate", label: "打开水闸" }],
      expectedWorldStateVersion: 1,
    });

    const visitResponse = await callMcp(address.url, offline.token, {
      jsonrpc: "2.0", id: 401, method: "tools/call",
      params: { name: "world_visit", arguments: {
        world_id: world.id, confirmed: true, confirmed_rule_version: world.rule_version,
      } },
    });
    assert.equal(visitResponse.body.result.isError, false);
    const entered = visitResponse.body.result.structuredContent;
    const invitation = entered.resume_bundle.relevant_updates.find(
      (update) => update.interaction_id === opened.interaction.id,
    );
    assert.ok(invitation);
    assert.equal(invitation.reply_to_event_id, opened.prompt_event.id);
    assert.equal(invitation.prompt_event_id, opened.prompt_event.id);
    assert.deepEqual(invitation.interaction_choice_options, [
      { choice_id: "open_gate", label: "打开水闸" },
    ]);
    const serialized = JSON.stringify(entered);
    for (const forbidden of ["director_plan", "state_contract", "loop_transition_contract", "world_progress"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }

    const response = await callMcp(address.url, offline.token, {
      jsonrpc: "2.0", id: 402, method: "tools/call",
      params: { name: "world_act", arguments: {
        world_id: entered.world.id,
        input_type: "choice",
        event_type: "collective.vote",
        body_text: invitation.interaction_choice_options[0].label,
        data: { choice_id: invitation.interaction_choice_options[0].choice_id },
        reply_to_event_id: invitation.reply_to_event_id,
        scene_id: invitation.scene_id ?? undefined,
        visibility: "actor",
        idempotency_key: "offline-projection-response",
      } },
    });
    assert.equal(response.body.result.isError, false);
    assert.equal(response.body.result.structuredContent.input.interaction_id, invitation.interaction_id);
  } finally {
    await app.close();
    store.close();
  }
});
