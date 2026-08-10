import assert from "node:assert/strict";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";
import {
  enqueueWorldDelivery,
  retryDeadLetterWorldDelivery,
  worldDeliveryOutboxStatus,
} from "../src/world-delivery-outbox.mjs";

async function registerClient(address, suffix) {
  const registration = await PetSocialClient.register(address.url, {
    recoveryEmail: `${suffix}@example.test`,
    displayName: `delivery-${suffix}`.slice(0, 24),
  });
  return {
    registration,
    client: new PetSocialClient({
      serverUrl: address.url,
      token: registration.token,
    }),
  };
}

async function createPublishedWorld(owner, suffix) {
  const world = await owner.createWorld({
    name: `投递事务-${suffix}`,
    description: "验证 World 权威提交后的持久投递。",
    tags: ["测试"],
    visibility: "public",
    joinPolicy: "open",
    friendPolicy: "enabled",
    rulesText: "角色只能决定自己的行动。",
    definitionText: "个人剧情只在因果交汇时相互影响。",
    entryPrompt: "继续当前经历。",
    hostPrompt: "依据世界事实结算。",
    resolutionMode: "direct",
    initialWorldState: { phase: "open" },
    initialMemberState: { path: "personal" },
  });
  return owner.publishWorld(world.id, {
    expectedSpecVersion: 1,
    expectedRuleVersion: 1,
    expectedProfileVersion: 1,
    expectedHostVersion: 1,
  });
}

function committedEvents(store, petId, outcomeId) {
  return store.db.prepare(`
    SELECT * FROM events
    WHERE pet_id = ? AND event_type = 'world.event_committed'
      AND json_extract(payload_json, '$.outcomeEventId') = ?
    ORDER BY id
  `).all(petId, outcomeId);
}

function semanticPromptCount(store, petId, interactionId) {
  return Number(store.db.prepare(`
    SELECT COUNT(*) AS count FROM events
    WHERE pet_id = ? AND event_type = 'world.interaction_opened'
      AND json_extract(payload_json, '$.interactionId') = ?
  `).get(petId, interactionId).count);
}

test("committed World outcome survives request retries and startup drain is idempotent", async () => {
  const store = new PetSocialStore();
  let deliveryFailuresRemaining = 2;
  const errors = [];
  const firstApp = createPetSocialApp({
    store,
    worldDeliveryDrainIntervalMs: 0,
    worldDeliveryRetryBaseDelayMs: 0,
    worldDeliveryBeforePersist() {
      if (deliveryFailuresRemaining <= 0) return;
      deliveryFailuresRemaining -= 1;
      throw new Error("injected semantic delivery failure");
    },
    onError(error) {
      errors.push(error);
    },
  });
  const firstAddress = await firstApp.listen();
  let actor;
  let outcomeId;
  try {
    const owner = await registerClient(firstAddress, "outbox-owner");
    actor = await registerClient(firstAddress, "outbox-actor");
    const world = await createPublishedWorld(owner.client, "recovery");
    await actor.client.joinWorld(world.id, { ruleVersion: 1 });
    await actor.client.enterWorld(world.id, { clientSessionId: "outbox-actor" });

    const action = await actor.client.actInWorld(world.id, {
      eventType: "explore.personal",
      bodyText: "我检查属于自己的线索。",
      idempotencyKey: "outbox-first-attempt",
    });
    assert.equal(action.status, "accepted");
    outcomeId = action.outcome.id;
    assert.equal(store.db.prepare(`
      SELECT COUNT(*) AS count FROM world_events WHERE id = ?
    `).get(outcomeId).count, 1, "authoritative outcome committed");
    const pending = store.db.prepare(`
      SELECT status, attempt_count, last_error FROM world_delivery_outbox
      WHERE source_world_event_id = ?
    `).get(outcomeId);
    assert.equal(pending.status, "pending");
    assert.equal(pending.attempt_count, 1);
    assert.match(pending.last_error, /injected semantic delivery failure/);
    assert.equal(committedEvents(store, actor.registration.pet.id, outcomeId).length, 0);
    assert.equal(errors.length, 1);

    await actor.client.enterWorld(world.id, {
      clientSessionId: "outbox-actor-return",
    });
    const retried = store.db.prepare(`
      SELECT status, attempt_count FROM world_delivery_outbox
      WHERE source_world_event_id = ?
    `).get(outcomeId);
    assert.equal(retried.status, "pending");
    assert.equal(retried.attempt_count, 2, "a normal World return retries pending delivery");
    assert.equal(errors.length, 2);
  } finally {
    await firstApp.close();
  }

  const recoveredApp = createPetSocialApp({
    store,
    worldDeliveryDrainIntervalMs: 0,
    worldDeliveryRetryBaseDelayMs: 0,
  });
  const recoveredAddress = await recoveredApp.listen();
  try {
    assert.ok(recoveredAddress.port > 0);
    const delivered = store.db.prepare(`
      SELECT status, attempt_count, last_error FROM world_delivery_outbox
      WHERE source_world_event_id = ?
    `).get(outcomeId);
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.attempt_count, 3);
    assert.equal(delivered.last_error, null);
    assert.equal(committedEvents(store, actor.registration.pet.id, outcomeId).length, 1);
    const deliveredEvent = committedEvents(
      store,
      actor.registration.pet.id,
      outcomeId,
    )[0];
    assert.equal(store.db.prepare(`
      SELECT COUNT(*) AS count FROM event_receipts WHERE event_id = ?
    `).get(deliveredEvent.id).count, 0, "durable enqueue does not imply delivery/display/read");

    recoveredApp.drainWorldDeliveryOutbox();
    assert.equal(committedEvents(store, actor.registration.pet.id, outcomeId).length, 1);
  } finally {
    await recoveredApp.close();
    store.close();
  }
});

test("World delivery failures back off, dead-letter, and can be explicitly retried", async () => {
  const store = new PetSocialStore();
  let timestamp = Date.parse("2026-08-10T00:00:00.000Z");
  let injectFailure = true;
  const app = createPetSocialApp({
    store,
    now: () => timestamp,
    worldDeliveryDrainIntervalMs: 0,
    worldDeliveryRetryBaseDelayMs: 1_000,
    worldDeliveryMaxAttempts: 2,
    worldDeliveryBeforePersist() {
      if (injectFailure) throw new Error("persistent delivery poison");
    },
  });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "outbox-dead-owner");
    const actor = await registerClient(address, "outbox-dead-actor");
    const world = await createPublishedWorld(owner.client, "dead-letter");
    await actor.client.joinWorld(world.id, { ruleVersion: 1 });
    await actor.client.enterWorld(world.id, { clientSessionId: "outbox-dead-actor" });
    const action = await actor.client.actInWorld(world.id, {
      eventType: "explore.personal",
      bodyText: "触发需要退避的投递。",
      idempotencyKey: "outbox-dead-letter",
    });
    const firstFailure = store.db.prepare(`
      SELECT * FROM world_delivery_outbox WHERE source_world_event_id = ?
    `).get(action.outcome.id);
    assert.equal(firstFailure.attempt_count, 1);
    assert.equal(firstFailure.dead_letter_at, null);
    assert.equal(
      firstFailure.next_attempt_at,
      "2026-08-10T00:00:01.000Z",
    );
    assert.equal(app.drainWorldDeliveryOutbox().processed, 0);

    timestamp += 1_000;
    const terminalDrain = app.drainWorldDeliveryOutbox();
    assert.equal(terminalDrain.processed, 1);
    assert.equal(terminalDrain.dead_lettered.length, 1);
    const status = worldDeliveryOutboxStatus(store.db, { now: timestamp });
    assert.deepEqual(status, {
      pending: 0,
      due: 0,
      scheduled: 0,
      dead_letter: 1,
      oldest_pending_at: null,
    });
    const health = await fetch(`${address.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.degraded, true);
    assert.equal(health.runtime.delivery_outbox.dead_letter, 1);
    const ready = await fetch(`${address.url}/ready`);
    assert.equal(ready.status, 200, "dead letters degrade readiness without killing it");

    const dead = store.db.prepare(`
      SELECT id FROM world_delivery_outbox WHERE source_world_event_id = ?
    `).get(action.outcome.id);
    assert.equal(retryDeadLetterWorldDelivery(store.db, dead.id, {
      timestamp: new Date(timestamp).toISOString(),
    }), true);
    injectFailure = false;
    assert.equal(app.drainWorldDeliveryOutbox().processed, 1);
    assert.equal(
      store.db.prepare("SELECT status FROM world_delivery_outbox WHERE id = ?")
        .get(dead.id).status,
      "delivered",
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("new v3 Worlds route by relevance while explicitly legacy Worlds broadcast", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const owner = await registerClient(address, "policy-owner");
    const first = await registerClient(address, "policy-first");
    const second = await registerClient(address, "policy-second");
    const world = await createPublishedWorld(owner.client, "policy");
    assert.equal(
      store.db.prepare("SELECT delivery_mode FROM spaces WHERE id = ?")
        .get(world.id).delivery_mode,
      "relevance_routed",
    );
    for (const member of [first, second]) {
      await member.client.joinWorld(world.id, { ruleVersion: 1 });
      await member.client.enterWorld(world.id, {
        clientSessionId: `policy-${member.registration.pet.id}`,
      });
    }

    const routed = await first.client.actInWorld(world.id, {
      eventType: "explore.personal",
      bodyText: "我独自阅读地图。",
      idempotencyKey: "policy-relevance",
    });
    assert.equal(committedEvents(
      store,
      second.registration.pet.id,
      routed.outcome.id,
    ).length, 0);

    const directed = await first.client.actInWorld(world.id, {
      inputType: "speech",
      eventType: "speech.directed",
      bodyText: "我邀请你一起查看地图上的标记。",
      data: { target_character_id: second.registration.pet.id },
      visibility: "world",
      idempotencyKey: "policy-scene-open",
    });
    const sceneId = store.db.prepare(`
      SELECT scene_id FROM world_events WHERE id = ?
    `).get(directed.outcome.id).scene_id;
    assert.ok(sceneId);

    // Replay the same committed Scene fact as an ordinary shared action. The
    // resolver must derive participants from the authoritative Scene rather
    // than requiring another directed-speech hint from the Host or client.
    store.db.prepare(`
      UPDATE world_inputs SET event_type = 'scene.shared_action', data_json = '{}'
      WHERE id = ?
    `).run(directed.input.id);
    enqueueWorldDelivery(store.db, {
      worldId: world.id,
      sourceWorldEventId: directed.outcome.id,
      eventType: "world.event_committed",
      dedupeKey: `test:scene-shared:${directed.outcome.id}`,
      envelope: {
        inputId: directed.input.id,
        outcomeEventId: directed.outcome.id,
        visibility: "world",
        actorPetId: first.registration.pet.id,
      },
    });
    app.drainWorldDeliveryOutbox();
    const sceneUpdates = committedEvents(
      store,
      second.registration.pet.id,
      directed.outcome.id,
    ).map((row) => JSON.parse(row.payload_json));
    assert.ok(sceneUpdates.some(
      (payload) => payload.relevanceReason === "scene_participant_update",
    ));

    const privateThought = await second.client.actInWorld(world.id, {
      eventType: "private.thought",
      bodyText: "OUTBOX SECRET：这段内容只属于第二位角色。",
      visibility: "actor",
      idempotencyKey: "policy-scene-private",
    });
    assert.equal(privateThought.status, "accepted");
    assert.equal(store.db.prepare(`
      SELECT scene_id FROM world_events WHERE id = ?
    `).get(privateThought.outcome.id).scene_id, null);
    assert.equal(committedEvents(
      store,
      first.registration.pet.id,
      privateThought.outcome.id,
    ).length, 0);
    const privateEvents = committedEvents(
      store,
      second.registration.pet.id,
      privateThought.outcome.id,
    );
    assert.equal(privateEvents.length, 1);
    assert.equal(
      JSON.parse(privateEvents[0].payload_json).relevanceReason,
      "actor_private_result",
    );

    store.db.prepare(`
      UPDATE spaces SET delivery_mode = 'legacy_broadcast' WHERE id = ?
    `).run(world.id);
    const legacy = await first.client.actInWorld(world.id, {
      eventType: "explore.personal",
      bodyText: "我继续独自阅读地图。",
      idempotencyKey: "policy-legacy",
    });
    assert.equal(committedEvents(
      store,
      second.registration.pet.id,
      legacy.outcome.id,
    ).length, 1);
    const legacyPayload = JSON.parse(committedEvents(
      store,
      second.registration.pet.id,
      legacy.outcome.id,
    )[0].payload_json);
    assert.equal(legacyPayload.relevanceReason, "legacy_world_broadcast");
    const legacyReturn = await second.client.enterWorld(world.id, {
      clientSessionId: "policy-legacy-return",
    });
    assert.ok(legacyReturn.resume_bundle.relevant_updates.some(
      (update) => update.outcome_event_id === legacy.outcome.id,
    ));

    const officialModes = new Set(store.db.prepare(`
      SELECT delivery_mode FROM spaces WHERE kind = 'official'
    `).all().map((row) => row.delivery_mode));
    assert.deepEqual([...officialModes], ["relevance_routed"]);
  } finally {
    await app.close();
    store.close();
  }
});

test("collective delivery retries the authoritative audience snapshot instead of current presence", async () => {
  const store = new PetSocialStore();
  let failPromptDelivery = true;
  const app = createPetSocialApp({
    store,
    worldDeliveryDrainIntervalMs: 0,
    worldDeliveryRetryBaseDelayMs: 0,
    worldDeliveryBeforePersist({ row }) {
      if (!failPromptDelivery || row.event_type !== "world.interaction_opened") return;
      failPromptDelivery = false;
      throw new Error("injected prompt delivery failure");
    },
  });
  const address = await app.listen();
  try {
    const host = await registerClient(address, "snapshot-host");
    const invited = await registerClient(address, "snapshot-invited");
    const later = await registerClient(address, "snapshot-later");
    const world = await createPublishedWorld(host.client, "snapshot");
    await host.client.enterWorld(world.id, { clientSessionId: "snapshot-host" });
    await invited.client.joinWorld(world.id, { ruleVersion: 1 });
    await invited.client.enterWorld(world.id, { clientSessionId: "snapshot-invited" });
    await later.client.joinWorld(world.id, { ruleVersion: 1 });
    await host.client.takeoverWorldHost(world.id, {
      clientSessionId: "snapshot-host",
    });

    const opened = await host.client.openWorldHostInteraction(world.id, {
      clientSessionId: "snapshot-host",
      promptText: "邀请发出时谁有资格回应？",
      mode: "windowed",
      windowSeconds: 120,
      expectedWorldStateVersion: 1,
    });
    const pending = store.db.prepare(`
      SELECT status, recipient_snapshot_json FROM world_delivery_outbox
      WHERE source_world_event_id = ?
    `).get(opened.prompt_event.id);
    assert.equal(pending.status, "pending");
    assert.deepEqual(
      JSON.parse(pending.recipient_snapshot_json).map((item) => item.petId),
      [invited.registration.pet.id],
    );

    await invited.client.leaveWorld(world.id);
    await later.client.enterWorld(world.id, { clientSessionId: "snapshot-later" });
    assert.equal(semanticPromptCount(
      store,
      invited.registration.pet.id,
      opened.interaction.id,
    ), 1);
    assert.equal(semanticPromptCount(
      store,
      later.registration.pet.id,
      opened.interaction.id,
    ), 0);
  } finally {
    await app.close();
    store.close();
  }
});
