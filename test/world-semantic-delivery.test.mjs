import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";

async function registerClient(address, suffix) {
  const registration = await PetSocialClient.register(address.url, {
    recoveryEmail: `${suffix}@example.test`,
    displayName: `character-${suffix}`.slice(0, 24),
  });
  return {
    registration,
    client: new PetSocialClient({
      serverUrl: address.url,
      token: registration.token,
    }),
  };
}

async function createWorld(owner, suffix, options = {}) {
  const world = await owner.createWorld({
    name: `语义投递-${suffix}`,
    description: "验证共享世界中的相关性投递。",
    tags: ["测试"],
    visibility: "public",
    joinPolicy: "open",
    friendPolicy: "enabled",
    rulesText: "角色只能决定自己的行动。",
    definitionText: "每个角色拥有独立剧情，因果交汇时才互动。",
    entryPrompt: "继续你的个人剧情。",
    hostPrompt: "只结算与当前角色有关的行动。",
    resolutionMode: options.resolutionMode ?? "direct",
    initialWorldState: { phase: "open" },
    initialMemberState: { loop: "personal" },
  });
  return owner.publishWorld(world.id, {
    expectedSpecVersion: 1,
    expectedRuleVersion: 1,
    expectedProfileVersion: 1,
    expectedHostVersion: 1,
  });
}

function semanticEvents(store, petId, eventType, predicate = () => true) {
  return store.db.prepare(`
    SELECT * FROM events WHERE pet_id = ? AND event_type = ? ORDER BY id ASC
  `).all(petId, eventType).filter((row) => predicate(JSON.parse(row.payload_json)));
}

test("independent A/B loops do not broadcast actions or presence changes", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "semantic-owner");
    const first = await registerClient(address, "semantic-a");
    const second = await registerClient(address, "semantic-b");
    const world = await createWorld(owner.client, "independent");
    for (const member of [first, second]) {
      await member.client.joinWorld(world.id, { ruleVersion: 1 });
      await member.client.enterWorld(world.id, {
        clientSessionId: `session-${member.registration.pet.id}`,
      });
    }

    const action = await first.client.actInWorld(world.id, {
      eventType: "explore.personal",
      bodyText: "我沿着自己的线索检查旧水井。",
      idempotencyKey: "semantic-independent-action",
    });
    assert.equal(action.status, "accepted");

    const firstEvents = semanticEvents(
      store,
      first.registration.pet.id,
      "world.event_committed",
      (payload) => payload.outcomeEventId === action.outcome.id,
    );
    assert.equal(firstEvents.length, 1);
    assert.deepEqual(
      Object.fromEntries([
        "relevance",
        "relevanceReason",
        "deliveryPolicy",
        "actionRequired",
      ].map((key) => [key, JSON.parse(firstEvents[0].payload_json)[key]])),
      {
        relevance: "self",
        relevanceReason: "own_action_result",
        deliveryPolicy: "digest",
        actionRequired: false,
      },
    );
    assert.equal(semanticEvents(
      store,
      second.registration.pet.id,
      "world.event_committed",
      (payload) => payload.outcomeEventId === action.outcome.id,
    ).length, 0);

    const sharedChange = await first.client.actInWorld(world.id, {
      eventType: "weather.change",
      bodyText: "我启动了会改变整座区域天气的装置。",
      proposedWorldStatePatch: { phase: "storm" },
      expectedWorldStateVersion: action.world_state.version,
      idempotencyKey: "semantic-shared-state-change",
    });
    assert.equal(sharedChange.status, "accepted");
    const sharedEvents = semanticEvents(
      store,
      second.registration.pet.id,
      "world.event_committed",
      (payload) => payload.relevanceReason === "shared_world_state_changed",
    );
    assert.equal(sharedEvents.length, 1);
    assert.equal(
      JSON.parse(sharedEvents[0].payload_json).relevanceReason,
      "shared_world_state_changed",
    );
    assert.equal(JSON.parse(sharedEvents[0].payload_json).outcomeEventId, undefined);
    assert.equal(JSON.parse(sharedEvents[0].payload_json).worldStateVersion, 2);
    const resumed = await second.client.enterWorld(world.id, {
      clientSessionId: "session-shared-state-return",
    });
    assert.equal(resumed.world_state.value.phase, "storm");
    assert.ok(resumed.resume_bundle.relevant_updates.some(
      (update) => update.relevance_reason === "shared_world_state_changed" &&
        update.world_state_version === 2 && update.outcome_event_id === null,
    ));
    assert.equal(store.db.prepare(`
      SELECT COUNT(*) AS count FROM events WHERE event_type = 'world.presence_changed'
    `).get().count, 0);
  } finally {
    await app.close();
    store.close();
  }
});

test("collective prompts and closure reach the snapshotted invited audience", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const host = await registerClient(address, "collective-host");
    const first = await registerClient(address, "collective-first");
    const second = await registerClient(address, "collective-second");
    const observer = await registerClient(address, "collective-observer");
    const offline = await registerClient(address, "collective-offline");
    const world = await createWorld(host.client, "collective");
    await host.client.enterWorld(world.id, { clientSessionId: "semantic-host" });
    await offline.client.joinWorld(world.id, { ruleVersion: 1 });
    for (const member of [first, second, observer]) {
      await member.client.joinWorld(world.id, { ruleVersion: 1 });
      await member.client.enterWorld(world.id, {
        clientSessionId: `session-${member.registration.pet.id}`,
      });
    }
    await host.client.takeoverWorldHost(world.id, {
      clientSessionId: "semantic-host",
    });
    const opened = await host.client.openWorldHostInteraction(world.id, {
      clientSessionId: "semantic-host",
      promptText: "是否共同打开水闸？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      expectedWorldStateVersion: 1,
    });
    for (const member of [first, second, observer]) {
      const promptEvents = semanticEvents(
        store,
        member.registration.pet.id,
        "world.interaction_opened",
        (payload) => payload.interactionId === opened.interaction.id,
      );
      assert.equal(promptEvents.length, 1);
      const payload = JSON.parse(promptEvents[0].payload_json);
      assert.equal(payload.relevanceReason, "collective_response_invited");
      assert.equal(payload.deliveryPolicy, "immediate");
      assert.equal(payload.actionRequired, false);
      const activityItem = (await member.client.activity()).items.find(
        (item) => item.interactionId === opened.interaction.id,
      );
      assert.equal(activityItem.promptEventId, opened.prompt_event.id);
      assert.equal(activityItem.replyToEventId, opened.prompt_event.id);
      assert.equal(activityItem.interactionQuorum, 2);
      assert.ok(activityItem.interactionClosesAt);
      assert.deepEqual(activityItem.reply, {
        available: true,
        tool: "world_act",
        worldId: world.id,
        replyToEventId: opened.prompt_event.id,
        sceneId: null,
      });
    }
    assert.equal(semanticEvents(
      store,
      host.registration.pet.id,
      "world.interaction_opened",
      (payload) => payload.interactionId === opened.interaction.id,
    ).length, 0, "the initiating Host is not interrupted by its own prompt");

    for (const [member, key] of [[first, "first"], [second, "second"]]) {
      const resumed = await member.client.enterWorld(world.id, {
        clientSessionId: `collective-resume-${key}`,
      });
      const invitation = resumed.resume_bundle.relevant_updates.find(
        (update) => update.interaction_id === opened.interaction.id,
      );
      assert.equal(invitation.reply_to_event_id, opened.prompt_event.id);
      assert.equal(invitation.interaction_quorum, 2);
      assert.ok(invitation.interaction_closes_at);
      await member.client.actInWorld(world.id, {
        inputType: "choice",
        eventType: "collective.vote",
        bodyText: `${key} agrees`,
        replyToEventId: invitation.reply_to_event_id,
        sceneId: invitation.scene_id ?? undefined,
        visibility: "actor",
        idempotencyKey: `semantic-collective-${key}`,
      });
    }
    const resolved = await host.client.resolveWorldHostInteraction(
      world.id,
      opened.interaction.id,
      {
        clientSessionId: "semantic-host",
        decision: "accepted",
        reasonText: "两位参与者同意。",
        outcomeText: "水闸已由参与者共同打开。",
        worldStatePatch: { phase: "gate_open" },
        expectedWorldStateVersion: 1,
      },
    );
    const observedResolution = await observer.client.observeWorld(world.id, {
      afterSequence: opened.prompt_event.sequence,
      limit: 50,
    });
    const serializedResolution = JSON.stringify(
      observedResolution.events.find((event) => event.id === resolved.outcome.id),
    );
    for (const forbidden of [
      first.registration.pet.id,
      second.registration.pet.id,
      ...resolved.inputs.map((item) => item.input?.id ?? item.id),
    ].filter((value) => typeof value === "string" && value)) {
      assert.doesNotMatch(serializedResolution, new RegExp(forbidden));
    }
    for (const member of [first, second]) {
      const resultEvents = semanticEvents(
        store,
        member.registration.pet.id,
        "world.event_committed",
        (payload) => payload.outcomeEventId === resolved.outcome.id,
      );
      assert.equal(resultEvents.length, 1);
      const payload = JSON.parse(resultEvents[0].payload_json);
      assert.equal(payload.relevanceReason, "collective_participant_result");
      assert.equal(payload.deliveryPolicy, "immediate");
    }
    const observerResults = semanticEvents(
      store,
      observer.registration.pet.id,
      "world.event_committed",
      (payload) => payload.outcomeEventId === resolved.outcome.id,
    );
    assert.equal(observerResults.length, 1);
    assert.equal(
      JSON.parse(observerResults[0].payload_json).relevanceReason,
      "collective_participant_result",
    );
    const offlineReturn = await offline.client.enterWorld(world.id, {
      clientSessionId: "semantic-offline-return",
    });
    assert.equal(offlineReturn.world_state.value.phase, "gate_open");
    const offlineUpdate = offlineReturn.resume_bundle.relevant_updates.find(
      (update) => update.relevance_reason === "shared_world_state_changed",
    );
    assert.ok(offlineUpdate);
    assert.equal(offlineUpdate.relevance_reason, "shared_world_state_changed");
    const rawOfflinePayload = JSON.stringify(JSON.parse(semanticEvents(
      store,
      offline.registration.pet.id,
      "world.event_committed",
      (payload) => payload.relevanceReason === "shared_world_state_changed",
    )[0].payload_json));
    assert.doesNotMatch(rawOfflinePayload, new RegExp(resolved.outcome.id));
    assert.doesNotMatch(rawOfflinePayload, /inputIds|participant_character_ids|participant_pet_ids/u);
    assert.doesNotMatch(rawOfflinePayload, new RegExp(first.registration.pet.id));
    assert.doesNotMatch(rawOfflinePayload, new RegExp(second.registration.pet.id));
  } finally {
    await app.close();
    store.close();
  }
});

test("Scene collective notifications reach participants and isolate unrelated members", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const host = await registerClient(address, "scene-notify-host");
    const first = await registerClient(address, "scene-notify-a");
    const second = await registerClient(address, "scene-notify-b");
    const observer = await registerClient(address, "scene-notify-c");
    const world = await createWorld(host.client, "scene-notify");
    await host.client.enterWorld(world.id, { clientSessionId: "scene-notify-host" });
    for (const member of [first, second, observer]) {
      await member.client.joinWorld(world.id, { ruleVersion: 1 });
      await member.client.enterWorld(world.id, {
        clientSessionId: `session-${member.registration.pet.id}`,
      });
    }
    await host.client.takeoverWorldHost(world.id, {
      clientSessionId: "scene-notify-host",
    });
    const directed = await first.client.actInWorld(world.id, {
      inputType: "speech",
      eventType: "speech.directed",
      bodyText: "我们需要就眼前这件事共同作出选择。",
      data: { target_character_id: second.registration.pet.id },
      visibility: "world",
      idempotencyKey: "scene-notify-directed",
    });
    const sceneId = store.db.prepare(`
      SELECT id FROM world_scenes WHERE source_input_id = ?
    `).get(directed.input.id).id;
    const opened = await host.client.openWorldHostInteraction(world.id, {
      clientSessionId: "scene-notify-host",
      sceneId,
      promptText: "甲乙准备如何处理这次交汇？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      expectedWorldStateVersion: 1,
    });
    for (const participant of [first, second]) {
      const notifications = semanticEvents(
        store,
        participant.registration.pet.id,
        "world.interaction_opened",
        (payload) => payload.interactionId === opened.interaction.id,
      );
      assert.equal(notifications.length, 1);
      assert.equal(JSON.parse(notifications[0].payload_json).sceneId, sceneId);
    }
    assert.equal(semanticEvents(
      store,
      observer.registration.pet.id,
      "world.interaction_opened",
      (payload) => payload.interactionId === opened.interaction.id,
    ).length, 0);
    const observerWorld = await observer.client.observeWorld(world.id, {
      afterSequence: 0,
    });
    assert.equal(
      observerWorld.active_interactions.some(
        (interaction) => interaction.id === opened.interaction.id,
      ),
      false,
    );
    assert.equal(
      observerWorld.events.some((event) => event.id === opened.prompt_event.id),
      false,
    );
    for (const [participant, key] of [[first, "a"], [second, "b"]]) {
      await participant.client.actInWorld(world.id, {
        inputType: "choice",
        eventType: "scene.collective_response",
        bodyText: `${key}在私有场景中回应。`,
        replyToEventId: opened.prompt_event.id,
        sceneId,
        visibility: "actor",
        idempotencyKey: `scene-notify-response-${key}`,
      });
    }
    const resolved = await host.client.resolveWorldHostInteraction(
      world.id,
      opened.interaction.id,
      {
        clientSessionId: "scene-notify-host",
        decision: "accepted",
        outcomeText: "SECRET AB outcome：只有甲乙知道交汇细节。",
        worldStatePatch: { phase: "scene_changed_shared_state" },
        expectedWorldStateVersion: 1,
      },
    );
    const participantPayload = JSON.parse(semanticEvents(
      store,
      first.registration.pet.id,
      "world.event_committed",
      (payload) => payload.outcomeEventId === resolved.outcome.id,
    )[0].payload_json);
    assert.match(participantPayload.outcomeText, /SECRET AB outcome/u);
    assert.equal(participantPayload.sceneId, sceneId);
    const outsiderPayload = JSON.parse(semanticEvents(
      store,
      observer.registration.pet.id,
      "world.event_committed",
      (payload) => payload.relevanceReason === "shared_world_state_changed",
    )[0].payload_json);
    assert.equal(outsiderPayload.relevanceReason, "shared_world_state_changed");
    assert.equal(outsiderPayload.outcomeText, "共享世界状态已发生变化。");
    assert.equal("sceneId" in outsiderPayload, false);
    assert.equal("interactionId" in outsiderPayload, false);
    assert.equal("outcomeEventId" in outsiderPayload, false);
    assert.equal(outsiderPayload.worldStateVersion, 2);
    assert.doesNotMatch(JSON.stringify(outsiderPayload), /SECRET AB outcome/u);
    const observerReturn = await observer.client.enterWorld(world.id, {
      clientSessionId: "scene-notify-observer-return",
    });
    const outsiderUpdate = observerReturn.resume_bundle.relevant_updates.find(
      (update) => update.relevance_reason === "shared_world_state_changed",
    );
    assert.equal(outsiderUpdate.summary, "共享世界状态已发生变化。");
    assert.equal(outsiderUpdate.scene_id, null);
    assert.equal(outsiderUpdate.outcome_event_id, null);
    assert.equal(outsiderUpdate.world_state_version, 2);
    assert.doesNotMatch(JSON.stringify(outsiderUpdate), /SECRET AB outcome/u);
    await assert.rejects(
      () => observer.client.actInWorld(world.id, {
        eventType: "scene.probe_hidden_reply",
        bodyText: "尝试用不可见事件探测私有 Scene。",
        replyToEventId: resolved.outcome.id,
        idempotencyKey: "scene-outsider-hidden-reply-probe",
      }),
      (error) => error.status === 404 && error.code === "NOT_FOUND" &&
        !JSON.stringify(error).includes(sceneId),
    );
  } finally {
    await app.close();
    store.close();
  }
});
