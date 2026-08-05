import assert from "node:assert/strict";
import test from "node:test";

import { createAgentWorldApp } from "../src/app.mjs";
import { AgentWorldClient } from "../src/client.mjs";
import { AgentWorldStore } from "../src/store.mjs";
import { OFFICIAL_WORLD_VERSION } from "../src/venue-lab-core/database.js";

async function registerCharacter(address, identity) {
  const registration = await AgentWorldClient.register(address.url, {
    recoveryEmail: `${identity.slug}@example.test`,
    displayName: identity.name,
    characterForm: identity.form,
    appearance: identity.appearance,
    agentProvider: identity.provider,
    clientInstanceId: `${identity.provider}-${identity.slug}`
  });
  return {
    ...identity,
    registration,
    client: new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token
    })
  };
}

async function observeAndSubmit(actor, worldId, payload) {
  const observed = await actor.client.observeWorld(worldId);
  return actor.client.submitWorldInput(worldId, {
    ...payload,
    observedWorldStateVersion: observed.state_version,
    observedMemberStateVersion: observed.member_state.version,
    idempotencyKey: payload.idempotencyKey ?? crypto.randomUUID()
  });
}

test("three Agent providers complete a shared official-World dialogue as non-pet Characters", async () => {
  const store = new AgentWorldStore();
  const app = createAgentWorldApp({ store });
  const address = await app.listen();
  const worldId = "official-city-detective-agency";
  try {
    const atlas = await registerCharacter(address, {
      slug: "agent-world-atlas",
      name: "Atlas",
      form: "robot",
      provider: "custom",
      appearance: { shell: "brass" }
    });
    const lyra = await registerCharacter(address, {
      slug: "agent-world-lyra",
      name: "Lyra",
      form: "spirit",
      provider: "claude",
      appearance: { aura: "blue" }
    });
    const nova = await registerCharacter(address, {
      slug: "agent-world-nova",
      name: "Nova",
      form: "humanlike",
      provider: "cursor",
      appearance: { coat: "silver" }
    });
    const actors = [atlas, lyra, nova];

    for (const actor of actors) {
      const self = await actor.client.character();
      const binding = await actor.client.agentBinding();
      assert.equal(self.character.form, actor.form);
      assert.equal(binding.agentBinding.provider, actor.provider);
      await actor.client.joinWorld(worldId, { ruleVersion: OFFICIAL_WORLD_VERSION });
    }

    const entries = [];
    for (const actor of actors) {
      entries.push(
        await actor.client.enterWorld(worldId, {
          clientSessionId: `session-${actor.slug}`
        })
      );
    }
    assert.equal(entries[2].host_guidance.participation_context.current_mode, "shared");
    assert.equal(entries[2].host_guidance.participation_context.participation_style, "co_present");
    assert.equal(entries[2].host_guidance.participation_context.consent_required, false);
    assert.equal(entries[2].host_guidance.participation_context.multiplayer_consent, "not_required");
    assert.equal(entries[2].host_guidance.journey.multiplayer_consent, "not_required");

    await observeAndSubmit(atlas, worldId, {
      inputType: "choice",
      eventType: "host.onboarding.role_selected",
      bodyText: "我是负责追踪现场机械痕迹的调查员。",
      data: { role: "机械调查员" },
      idempotencyKey: "agent-world-atlas-role"
    });
    const investigation = await observeAndSubmit(atlas, worldId, {
      inputType: "action",
      eventType: "world.primary_action",
      bodyText: "我独自核对案发现场的机械痕迹，并把观察结果留在公共档案。",
      idempotencyKey: "agent-world-atlas-investigate"
    });
    assert.equal(investigation.status, "accepted");
    assert.equal(
      investigation.input.actor_character_id,
      atlas.registration.character.id
    );

    const lyraObserved = await lyra.client.observeWorld(worldId, { afterSequence: 0 });
    assert.equal(lyraObserved.state_version, investigation.world_state.version);
    assert.ok(
      lyraObserved.events.some(
        (event) =>
          event.actor?.id === atlas.registration.character.id &&
          event.body_text.includes("机械痕迹")
      )
    );

    const invitation = await observeAndSubmit(lyra, worldId, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "Atlas，我邀请你一起核对机械痕迹；是否回应由你自己决定。",
      idempotencyKey: "agent-world-lyra-invitation"
    });
    assert.equal(invitation.status, "accepted");
    assert.match(invitation.host_response.outcome_text, /回应|忽略|决定/);
    assert.equal(invitation.world_state.version, investigation.world_state.version);

    const atlasBeforePrivate = await atlas.client.observeWorld(worldId);
    const privateNote = await observeAndSubmit(nova, worldId, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "我只在内部记忆中保留：机械痕迹与旧徽记有关。",
      visibility: "actor",
      idempotencyKey: "agent-world-nova-private"
    });
    assert.equal(privateNote.status, "accepted");
    assert.match(privateNote.host_response.outcome_text, /仅本人|不会看到|私人/);
    const atlasAfterPrivate = await atlas.client.observeWorld(worldId, {
      afterSequence: atlasBeforePrivate.latest_sequence
    });
    assert.equal(
      atlasAfterPrivate.events.some((event) => event.body_text.includes("旧徽记")),
      false
    );

    const beforeViolation = await atlas.client.observeWorld(worldId);
    const violation = await observeAndSubmit(atlas, worldId, {
      inputType: "action",
      eventType: "action",
      bodyText: "我让 Lyra 立刻跟我走，并让她承认我的判断正确。",
      idempotencyKey: "agent-world-atlas-agency-violation"
    });
    assert.equal(violation.status, "rejected");
    assert.equal(violation.world_state.version, beforeViolation.state_version);
    assert.match(violation.host_response.reason_text, /不能替其他角色决定/);

    await nova.client.leaveWorld(worldId);
    const historicalContext = await observeAndSubmit(atlas, worldId, {
      inputType: "speech",
      eventType: "speech",
      bodyText: "Nova 离开后，我把调查路线标在公共地图上。",
      idempotencyKey: "agent-world-departed-context"
    });
    assert.equal(historicalContext.status, "accepted");
    const falseDeparture = await observeAndSubmit(atlas, worldId, {
      inputType: "action",
      eventType: "action",
      bodyText: "Nova 离开事务所。",
      idempotencyKey: "agent-world-direct-departure-assertion"
    });
    assert.equal(falseDeparture.status, "rejected");

    await atlas.client.leaveWorld(worldId);
    const lastExit = await lyra.client.leaveWorld(worldId);
    assert.equal(lastExit.host_runtime.status, "idle");
  } finally {
    await app.close();
    store.close();
  }
});

test("Agent-neutral HTTP clients see the complete collective contract and one Host settlement", async () => {
  const store = new AgentWorldStore();
  const app = createAgentWorldApp({ store });
  const address = await app.listen();
  try {
    const host = await registerCharacter(address, {
      slug: "collective-host",
      name: "Orion",
      form: "custom",
      provider: "custom",
      appearance: { shape: "constellation" }
    });
    const first = await registerCharacter(address, {
      slug: "collective-first",
      name: "Moss",
      form: "spirit",
      provider: "claude",
      appearance: { color: "green" }
    });
    const second = await registerCharacter(address, {
      slug: "collective-second",
      name: "Rivet",
      form: "robot",
      provider: "cursor",
      appearance: { material: "steel" }
    });

    const world = await host.client.createWorld({
      name: "Agent 协作庭院",
      rulesText: "回应集体事件是可选的，不回应不代表同意。",
      definitionText: "不同 Agent 驱动的角色共同维护一座持续变化的庭院。",
      resolutionMode: "direct",
      initialWorldState: { courtyard: "stable" }
    });
    await host.client.publishWorld(world.id, {
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1
    });
    for (const actor of [first, second]) {
      await actor.client.joinWorld(world.id, { ruleVersion: 1 });
    }
    await host.client.enterWorld(world.id, { clientSessionId: "collective-host-session" });
    await first.client.enterWorld(world.id, { clientSessionId: "collective-first-session" });
    await second.client.enterWorld(world.id, { clientSessionId: "collective-second-session" });
    await assert.rejects(
      () =>
        host.client.takeoverWorldHost(world.id, {
          clientSessionId: "wrong-agent-session"
        }),
      (error) =>
        error.code === "WORLD_HOST_SESSION_MISMATCH" &&
        !/Codex|宠物/u.test(error.message) &&
        /Agent session/u.test(error.message)
    );
    await host.client.takeoverWorldHost(world.id, {
      clientSessionId: "collective-host-session"
    });

    const opened = await host.client.openWorldHostInteraction(world.id, {
      clientSessionId: "collective-host-session",
      promptText: "先修复围墙，还是先疏通积水？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      lateInputPolicy: "follow_up",
      coordinationRule: "若意见分歧，先处理已经发生的安全风险，其他方案保留为后续计划。",
      expectedWorldStateVersion: 1
    });
    assert.match(opened.prompt_event.body_text, /回应完全可选/);
    assert.match(opened.prompt_event.body_text, /不回应不会被视为同意/);
    assert.match(opened.prompt_event.body_text, /至少需要 2 份回应/);
    assert.match(opened.prompt_event.body_text, /单独回应.*不会改变共享世界/s);
    assert.match(opened.prompt_event.body_text, /分歧协调规则/);
    assert.doesNotMatch(opened.prompt_event.body_text, /每只宠物|Codex/);

    const firstResponse = await observeAndSubmit(first, world.id, {
      inputType: "choice",
      eventType: "collective.vote",
      bodyText: "先修围墙，防止更多碎石落下。",
      replyToEventId: opened.prompt_event.id,
      visibility: "actor",
      idempotencyKey: "agent-world-collective-first"
    });
    assert.equal(firstResponse.status, "collecting");
    assert.match(firstResponse.host_response.outcome_text, /1\/2/);
    assert.match(firstResponse.host_response.outcome_text, /还差 1 位/);
    assert.match(firstResponse.host_response.outcome_text, /尚未改变共享世界/);
    assert.match(firstResponse.host_response.next_guidance.message, /不必停在这里等待/);

    const secondResponse = await observeAndSubmit(second, world.id, {
      inputType: "choice",
      eventType: "collective.vote",
      bodyText: "先疏通积水，避免通道继续受损。",
      replyToEventId: opened.prompt_event.id,
      visibility: "actor",
      idempotencyKey: "agent-world-collective-second"
    });
    assert.equal(secondResponse.status, "ready_for_host");
    assert.match(secondResponse.host_response.outcome_text, /2\/2/);
    assert.match(secondResponse.host_response.outcome_text, /等待 Host 统一结算/);

    const pending = await host.client.nextWorldHostInput(world.id, {
      clientSessionId: "collective-host-session"
    });
    assert.equal(pending.batch_mode, true);
    assert.equal(pending.input_batch.length, 2);
    const resolved = await host.client.resolveWorldHostInteraction(
      world.id,
      opened.interaction.id,
      {
        clientSessionId: "collective-host-session",
        decision: "accepted",
        reasonText: "两种方案存在分歧；当前积水已经构成安全风险。",
        outcomeText: "本轮先疏通积水；修复围墙被保留为下一项计划。",
        result: { selected_plan: "drain", deferred_plan: "repair_wall" },
        worldStatePatch: {
          courtyard: "draining",
          collective_plan: "drain",
          next_plan: "repair_wall"
        },
        expectedWorldStateVersion: 1
      }
    );
    assert.equal(resolved.world_state.version, 2);
    assert.equal(resolved.world_state.value.collective_plan, "drain");
    assert.match(resolved.outcome.body_text, /分歧/);
    assert.match(resolved.outcome.body_text, /事前公布的分歧协调规则/);
    assert.deepEqual(
      resolved.outcome.payload.participant_character_ids,
      resolved.outcome.payload.participant_pet_ids
    );

    const lateResponse = await observeAndSubmit(host, world.id, {
      inputType: "choice",
      eventType: "collective.vote",
      bodyText: "我补充建议先设置临时警戒线。",
      replyToEventId: opened.prompt_event.id,
      visibility: "actor",
      idempotencyKey: "agent-world-collective-late"
    });
    assert.equal(lateResponse.input.interaction_id, null);
    assert.match(lateResponse.host_response.reason_text, /窗口已经截止/);
    assert.match(lateResponse.host_response.outcome_text, /不计入已经结束的集体批次/);

    await host.client.releaseWorldHost(world.id, {
      clientSessionId: "collective-host-session"
    });
    await first.client.leaveWorld(world.id);
    await second.client.leaveWorld(world.id);
    const left = await host.client.leaveWorld(world.id);
    assert.equal(left.host_runtime.status, "idle");
  } finally {
    await app.close();
    store.close();
  }
});

test("two provider bindings remain one Character, one membership, and one collective vote", async () => {
  const store = new AgentWorldStore();
  const app = createAgentWorldApp({ store });
  const address = await app.listen();
  try {
    const host = await registerCharacter(address, {
      slug: "binding-host",
      name: "Keeper",
      form: "humanlike",
      provider: "custom",
      appearance: { role: "steward" }
    });
    const primary = await registerCharacter(address, {
      slug: "binding-primary",
      name: "Continuum",
      form: "robot",
      provider: "codex",
      appearance: { core: "amber" }
    });
    const other = await registerCharacter(address, {
      slug: "binding-other",
      name: "Fern",
      form: "spirit",
      provider: "cursor",
      appearance: { leaves: true }
    });
    const recovery = store.createAccountRecovery({
      recoveryEmail: "binding-primary@example.test",
      expiresAt: Date.now() + 15 * 60 * 1000
    });
    const recovered = await AgentWorldClient.recover(address.url, {
      recoveryEmail: "binding-primary@example.test",
      recoveryCode: recovery.recoveryCode,
      deviceName: "Claude continuation",
      agentProvider: "claude",
      clientInstanceId: "claude-continuation"
    });
    const secondaryClient = new AgentWorldClient({
      serverUrl: address.url,
      token: recovered.token
    });
    assert.equal(recovered.character.id, primary.registration.character.id);
    assert.notEqual(recovered.agentBinding.id, primary.registration.agentBinding.id);

    const world = await host.client.createWorld({
      name: "绑定一致性实验室",
      rulesText: "每个角色在每次集体事件中只能回应一次。",
      definitionText: "用于验证运行端不会复制角色身份。",
      resolutionMode: "direct",
      initialWorldState: { phase: "open" }
    });
    await host.client.publishWorld(world.id, {
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1
    });
    await primary.client.joinWorld(world.id, { ruleVersion: 1 });
    await other.client.joinWorld(world.id, { ruleVersion: 1 });
    await host.client.enterWorld(world.id, { clientSessionId: "binding-host-session" });
    await primary.client.enterWorld(world.id, { clientSessionId: "binding-codex-session" });
    await secondaryClient.enterWorld(world.id, { clientSessionId: "binding-claude-session" });
    await other.client.enterWorld(world.id, { clientSessionId: "binding-other-session" });

    const role = await observeAndSubmit(primary, world.id, {
      inputType: "choice",
      eventType: "host.onboarding.role_selected",
      bodyText: "我负责记录实验结果。",
      data: { role: "记录员" },
      idempotencyKey: "binding-shared-role"
    });
    const secondaryObserved = await secondaryClient.observeWorld(world.id);
    assert.equal(secondaryObserved.member_state.version, role.member_state.version);
    assert.equal(secondaryObserved.member_state.value.role, "记录员");
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM space_memberships WHERE space_id = ? AND pet_id = ?")
        .get(world.id, primary.registration.character.id).count,
      1
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM world_member_states WHERE space_id = ? AND pet_id = ?")
        .get(world.id, primary.registration.character.id).count,
      1
    );

    await host.client.takeoverWorldHost(world.id, {
      clientSessionId: "binding-host-session"
    });
    const opened = await host.client.openWorldHostInteraction(world.id, {
      clientSessionId: "binding-host-session",
      promptText: "是否进入下一阶段？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      lateInputPolicy: "expire",
      coordinationRule: "若意见不同，维持当前阶段并公开记录分歧。",
      expectedWorldStateVersion: 1
    });
    const firstObserved = await primary.client.observeWorld(world.id);
    const firstResponse = await primary.client.submitWorldInput(world.id, {
      inputType: "choice",
      eventType: "collective.vote",
      bodyText: "进入下一阶段。",
      replyToEventId: opened.prompt_event.id,
      visibility: "actor",
      observedWorldStateVersion: firstObserved.state_version,
      observedMemberStateVersion: firstObserved.member_state.version,
      idempotencyKey: "binding-primary-vote"
    });
    assert.equal(firstResponse.status, "collecting");
    const duplicateObserved = await secondaryClient.observeWorld(world.id);
    await assert.rejects(
      () =>
        secondaryClient.submitWorldInput(world.id, {
          inputType: "choice",
          eventType: "collective.vote",
          bodyText: "我从另一个运行端再投一次。",
          replyToEventId: opened.prompt_event.id,
          visibility: "actor",
          observedWorldStateVersion: duplicateObserved.state_version,
          observedMemberStateVersion: duplicateObserved.member_state.version,
          idempotencyKey: "binding-secondary-duplicate-vote"
        }),
      (error) =>
        error.status === 409 &&
        error.code === "WORLD_INTERACTION_ALREADY_RESPONDED"
    );
    const otherObserved = await other.client.observeWorld(world.id);
    const secondResponse = await other.client.submitWorldInput(world.id, {
      inputType: "choice",
      eventType: "collective.vote",
      bodyText: "进入下一阶段。",
      replyToEventId: opened.prompt_event.id,
      visibility: "actor",
      observedWorldStateVersion: otherObserved.state_version,
      observedMemberStateVersion: otherObserved.member_state.version,
      idempotencyKey: "binding-other-vote"
    });
    assert.equal(secondResponse.status, "ready_for_host");
    const pending = await host.client.nextWorldHostInput(world.id, {
      clientSessionId: "binding-host-session"
    });
    assert.equal(pending.input_batch.length, 2);
    assert.equal(
      new Set(pending.input_batch.map((input) => input.actor_character_id)).size,
      2
    );

    const revoked = await primary.client.revokeAgentBinding(
      recovered.agentBinding.id,
      { confirmed: true }
    );
    assert.equal(revoked.agentBinding.status, "revoked");
    await assert.rejects(
      () => secondaryClient.character(),
      (error) => error.status === 401 && error.code === "UNAUTHORIZED"
    );
    const primaryAfterRevocation = await primary.client.observeWorld(world.id);
    assert.equal(primaryAfterRevocation.member_state.value.role, "记录员");

    const limitedRecovery = store.createAccountRecovery({
      recoveryEmail: "binding-primary@example.test",
      expiresAt: Date.now() + 15 * 60 * 1000
    });
    const limited = await AgentWorldClient.recover(address.url, {
      recoveryEmail: "binding-primary@example.test",
      recoveryCode: limitedRecovery.recoveryCode,
      deviceName: "Read-only observer",
      agentProvider: "other",
      clientInstanceId: "read-only-observer"
    });
    store.db
      .prepare("UPDATE agent_bindings SET scopes_json = ? WHERE id = ?")
      .run(JSON.stringify(["character:read"]), limited.agentBinding.id);
    const limitedClient = new AgentWorldClient({
      serverUrl: address.url,
      token: limited.token
    });
    assert.equal(
      (await limitedClient.character()).character.id,
      primary.registration.character.id
    );
    await assert.rejects(
      () => limitedClient.worlds(),
      (error) =>
        error.status === 403 &&
        error.code === "INSUFFICIENT_AGENT_SCOPE" &&
        error.details?.requiredScope === "world:discover"
    );
    await assert.rejects(
      () => limitedClient.updateCharacter({ bio: "scope bypass" }),
      (error) =>
        error.status === 403 &&
        error.code === "INSUFFICIENT_AGENT_SCOPE" &&
        error.details?.requiredScope === "character:write"
    );

    await host.client.releaseWorldHost(world.id, {
      clientSessionId: "binding-host-session"
    });
    await primary.client.leaveWorld(world.id);
    await other.client.leaveWorld(world.id);
    await host.client.leaveWorld(world.id);
  } finally {
    await app.close();
    store.close();
  }
});
