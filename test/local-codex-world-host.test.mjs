import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAgentWorldApp } from "../src/app.mjs";
import { AgentWorldClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";
import {
  parseWorldHostDecision,
} from "../src/world-host-runner.mjs";

class FakeCodexWorldHosts {
  constructor() {
    this.created = [];
    this.turns = [];
  }

  async createWorldHostThread({ worldId, worldName, cwd }) {
    const thread = { id: `thread:${worldId}` };
    this.created.push({ worldId, worldName, cwd, threadId: thread.id });
    return thread;
  }

  async runWorldHostTurn({ threadId, prompt }) {
    this.turns.push({ threadId, prompt });
    return {
      threadId,
      turnId: `turn:${this.turns.length}`,
      text: JSON.stringify({
        decision: "accepted",
        resolution_disposition: "apply",
        reason_text: "输入符合当前 World 规则。",
        outcome_text: `${threadId} 已处理该输入。`,
        result: { resolution: "full_success" },
      }),
    };
  }

  close() {}
}

class SlowFakeCodexWorldHosts extends FakeCodexWorldHosts {
  async runWorldHostTurn(args) {
    await new Promise((resolve) => setTimeout(resolve, 75));
    return super.runWorldHostTurn(args);
  }
}

async function createPublishedWorld(client, name, marker) {
  const world = await client.createWorld({
    name,
    description: `${name} 的公开说明`,
    rulesText: `只能处理 ${marker} World 内的信息。`,
    definitionText: `隔离标记：${marker}`,
    resolutionMode: "direct",
    initialWorldState: { marker },
  });
  await client.publishWorld(world.id, {
    expectedSpecVersion: world.spec_version,
    expectedRuleVersion: world.rule_version,
    expectedProfileVersion: world.profile_version,
    expectedHostVersion: world.world_agent.version,
  });
  return world;
}

async function submitAndDrain(app, client, world, key) {
  await client.enterWorld(world.id, { clientSessionId: `session:${key}` });
  const observed = await client.observeWorld(world.id);
  const pending = await client.submitWorldInput(world.id, {
    inputType: "speech",
    eventType: "speak",
    bodyText: `来自 ${key} 的输入`,
    observedWorldStateVersion: observed.world_state.version,
    observedMemberStateVersion: observed.member_state.version,
    idempotencyKey: `input:${key}`,
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.host_runtime.engine, "local_codex_world_host");
  assert.equal(pending.host_runtime.context_isolation, "one_thread_per_world");
  await app.worldHostRunner.whenIdle();
  return client.observeWorld(world.id);
}

test("each World binds one isolated local Codex Host thread", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-isolation-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new FakeCodexWorldHosts();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: codex,
    worldHostMaxConcurrency: 2,
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-isolation@example.test",
      displayName: "Host 隔离测试者",
      agentProvider: "codex",
    });
    const client = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const first = await createPublishedWorld(client, "琥珀世界", "AMBER_ONLY");
    const second = await createPublishedWorld(client, "青瓷世界", "CELADON_ONLY");

    const firstObserved = await submitAndDrain(app, client, first, "amber");
    assert.match(firstObserved.events.at(-1).body_text, /thread:/u);
    const secondObserved = await submitAndDrain(app, client, second, "celadon");
    assert.match(secondObserved.events.at(-1).body_text, /thread:/u);

    assert.equal(codex.created.length, 2);
    assert.equal(new Set(codex.created.map((item) => item.threadId)).size, 2);
    assert.equal(codex.turns.length, 2);
    const amberTurn = codex.turns.find((item) => item.threadId === `thread:${first.id}`);
    const celadonTurn = codex.turns.find((item) => item.threadId === `thread:${second.id}`);
    assert.match(amberTurn.prompt, /AMBER_ONLY/u);
    assert.doesNotMatch(amberTurn.prompt, /CELADON_ONLY/u);
    assert.match(celadonTurn.prompt, /CELADON_ONLY/u);
    assert.doesNotMatch(celadonTurn.prompt, /AMBER_ONLY/u);

    const executors = store.db
      .prepare(`
        SELECT space_id, codex_thread_id, status, last_turn_id
        FROM world_host_executors
        WHERE space_id IN (?, ?)
        ORDER BY space_id
      `)
      .all(first.id, second.id);
    assert.equal(executors.length, 2);
    assert.ok(executors.every((row) => row.status === "idle"));
    assert.ok(executors.every((row) => row.codex_thread_id));
    assert.ok(executors.every((row) => row.last_turn_id));
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a submitted action is acknowledged and its final Host result is waitable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-result-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: new SlowFakeCodexWorldHosts(),
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-result@example.test",
      displayName: "结果等待测试者",
      agentProvider: "codex",
    });
    const client = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const world = await createPublishedWorld(client, "回声世界", "RESULT_ONLY");
    await client.enterWorld(world.id, { clientSessionId: "result-session" });
    const observed = await client.observeWorld(world.id);
    const acknowledged = await client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "inspect",
      bodyText: "检查回声来自哪里。",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "result:inspect",
    });

    assert.equal(acknowledged.processing.acknowledged, true);
    assert.equal(acknowledged.processing.final, false);
    assert.equal(acknowledged.processing.result_tool, "world_input_result");

    const completed = await client.worldInputResult(
      world.id,
      acknowledged.input.id,
      { waitMs: 2_000 },
    );
    assert.equal(completed.processing.state, "completed");
    assert.equal(completed.processing.final, true);
    assert.equal(completed.status, "accepted");
    assert.match(completed.host_response.outcome_text, /已处理该输入/u);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("beta startup prewarms one isolated Host for every published World", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-prewarm-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new FakeCodexWorldHosts();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: codex,
    worldHostRoot: join(directory, "hosts"),
    worldHostPrewarm: true,
  });
  try {
    const result = await app.worldHostPrewarm;
    const expectedCount = Number(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM spaces WHERE publication_status = 'published'")
        .get().count,
    );
    assert.equal(result.failed_world_ids.length, 0);
    assert.equal(result.bound_world_ids.length, expectedCount);
    assert.equal(codex.created.length, expectedCount);
    assert.equal(new Set(codex.created.map((item) => item.threadId)).size, expectedCount);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a ready collective interaction is settled by the same isolated World Host", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-batch-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new FakeCodexWorldHosts();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: codex,
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const ownerRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-batch-owner@example.test",
      displayName: "批次世界创建者",
      agentProvider: "codex",
    });
    const guestRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-batch-guest@example.test",
      displayName: "批次世界访客",
      agentProvider: "claude",
    });
    const owner = new AgentWorldClient({
      serverUrl: address.url,
      token: ownerRegistration.token,
    });
    const guest = new AgentWorldClient({
      serverUrl: address.url,
      token: guestRegistration.token,
    });
    const world = await createPublishedWorld(
      owner,
      "集体决策世界",
      "COLLECTIVE_ONLY",
    );
    await guest.joinWorld(world.id, { ruleVersion: world.rule_version });
    await owner.enterWorld(world.id, { clientSessionId: "batch-owner-session" });
    await guest.enterWorld(world.id, { clientSessionId: "batch-guest-session" });
    await owner.takeoverWorldHost(world.id, {
      clientSessionId: "batch-owner-session",
    });
    const opened = await owner.openWorldHostInteraction(world.id, {
      clientSessionId: "batch-owner-session",
      promptText: "选择左路还是右路？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      expectedWorldStateVersion: 1,
    });
    await owner.releaseWorldHost(world.id, {
      clientSessionId: "batch-owner-session",
    });

    for (const [client, key, reply] of [
      [owner, "owner", "我选择左路。"],
      [guest, "guest", "我选择右路。"],
    ]) {
      const observed = await client.observeWorld(world.id);
      await client.submitWorldInput(world.id, {
        inputType: "choice",
        eventType: "collective.vote",
        bodyText: reply,
        replyToEventId: opened.prompt_event.id,
        visibility: "actor",
        observedWorldStateVersion: observed.world_state.version,
        observedMemberStateVersion: observed.member_state.version,
        idempotencyKey: `batch:${key}`,
      });
    }
    await app.worldHostRunner.whenIdle();

    assert.equal(codex.created.length, 1);
    assert.equal(codex.turns.length, 1);
    assert.equal(codex.turns[0].threadId, `thread:${world.id}`);
    assert.match(codex.turns[0].prompt, /collective interaction batch/u);
    assert.match(codex.turns[0].prompt, /COLLECTIVE_ONLY/u);
    const resolution = store.db
      .prepare(`
        SELECT resolution_source
        FROM world_interaction_resolutions
        WHERE interaction_id = ?
      `)
      .get(opened.interaction.id);
    assert.equal(resolution.resolution_source, "platform");
    const interaction = store.db
      .prepare("SELECT status FROM world_interactions WHERE id = ?")
      .get(opened.interaction.id);
    assert.equal(interaction.status, "resolved");
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("World Host decisions require a bounded structured contract", () => {
  assert.deepEqual(
    parseWorldHostDecision(JSON.stringify({
      decision: "clarification",
      resolution_disposition: "conflict",
      reason_text: "状态已经改变。",
      outcome_text: "请基于最新状态确认下一步。",
      result: {},
    })).decision,
    "clarification",
  );
  assert.throws(
    () => parseWorldHostDecision("not-json"),
    /not valid JSON/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      decision: "rejected",
      resolution_disposition: "apply",
      reason_text: "不允许。",
      outcome_text: "没有改变世界。",
      result: {},
      world_state_patch: { leaked: true },
    })),
    /Only an accepted/u,
  );
});
