import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAgentWorldApp } from "../src/app.mjs";
import { AgentWorldClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";
import {
  LocalCodexWorldHostRunner,
  parseWorldHostDecision,
} from "../src/world-host-runner.mjs";

class FakeCodexWorldHosts {
  constructor() {
    this.created = [];
    this.turns = [];
  }

  async createWorldHostThread({ worldId, worldName, cwd, ephemeral }) {
    const thread = { id: `thread:${worldId}:${this.created.length + 1}` };
    this.created.push({ worldId, worldName, cwd, ephemeral, threadId: thread.id });
    return thread;
  }

  async runWorldHostTurn({ threadId, prompt, resume }) {
    this.turns.push({ threadId, prompt, resume });
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

class ControlledFakeCodexWorldHosts extends FakeCodexWorldHosts {
  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.released = new Promise((resolve) => {
      this.resolveReleased = resolve;
    });
  }

  async runWorldHostTurn(args) {
    this.resolveStarted();
    await this.released;
    return super.runWorldHostTurn(args);
  }

  completeTurn() {
    this.resolveReleased();
  }
}

test("persistent per-World Host threads are rejected to preserve Character privacy", () => {
  const store = new PetSocialStore(":memory:");
  try {
    assert.throws(
      () => new LocalCodexWorldHostRunner({
        db: store.db,
        codexClient: new FakeCodexWorldHosts(),
        threadIsolation: "per_world",
      }),
      /threadIsolation must be per_turn/u,
    );
  } finally {
    store.close();
  }
});

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
  assert.equal(pending.host_runtime.context_isolation, "one_fresh_thread_per_turn");
  await app.worldHostRunner.whenIdle();
  return client.observeWorld(world.id);
}

test("every Host turn gets a fresh isolated local Codex thread", async () => {
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
    await submitAndDrain(app, client, first, "amber-again");

    assert.equal(codex.created.length, 3);
    assert.equal(new Set(codex.created.map((item) => item.threadId)).size, 3);
    assert.ok(codex.created.every((item) => item.ephemeral === true));
    assert.equal(codex.turns.length, 3);
    assert.ok(codex.turns.every((item) => item.resume === false));
    const amberTurn = codex.turns.find((item) => item.prompt.includes("来自 amber 的输入"));
    const celadonTurn = codex.turns.find((item) => item.prompt.includes("来自 celadon 的输入"));
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

test("actor-private history is absent from another Character's fresh Host turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-private-isolation-"));
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
      recoveryEmail: "host-private-owner@example.test",
      displayName: "私密行动者",
      agentProvider: "codex",
    });
    const guestRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-private-guest@example.test",
      displayName: "后续行动者",
      agentProvider: "other",
    });
    const owner = new AgentWorldClient({
      serverUrl: address.url,
      token: ownerRegistration.token,
    });
    const guest = new AgentWorldClient({
      serverUrl: address.url,
      token: guestRegistration.token,
    });
    const world = await createPublishedWorld(owner, "私密边界世界", "PRIVATE_BOUNDARY");
    await guest.joinWorld(world.id, { ruleVersion: world.rule_version });
    await owner.enterWorld(world.id, { clientSessionId: "private-owner" });
    await guest.enterWorld(world.id, { clientSessionId: "private-guest" });

    let observed = await owner.observeWorld(world.id);
    await owner.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "private_note",
      bodyText: "PRIVATE_SENTINEL_ONLY_FOR_OWNER",
      visibility: "actor",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "private-sentinel-owner",
    });
    await app.worldHostRunner.whenIdle();

    observed = await guest.observeWorld(world.id);
    await guest.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "public_followup",
      bodyText: "我检查公共区域的新变化。",
      visibility: "world",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "public-followup-guest",
    });
    await app.worldHostRunner.whenIdle();

    assert.equal(codex.turns.length, 2);
    assert.notEqual(codex.turns[0].threadId, codex.turns[1].threadId);
    assert.match(codex.turns[0].prompt, /PRIVATE_SENTINEL_ONLY_FOR_OWNER/u);
    assert.doesNotMatch(codex.turns[1].prompt, /PRIVATE_SENTINEL_ONLY_FOR_OWNER/u);
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

test("a platform Host cannot commit after a creator takes over mid-turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-takeover-fence-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new ControlledFakeCodexWorldHosts();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: codex,
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-takeover-fence@example.test",
      displayName: "Host 接管测试者",
      agentProvider: "codex",
    });
    const owner = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const world = await createPublishedWorld(owner, "接管栅栏世界", "FENCE_ONLY");
    await owner.enterWorld(world.id, { clientSessionId: "takeover-fence-session" });
    const observed = await owner.observeWorld(world.id);
    const pending = await owner.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "inspect",
      bodyText: "等待平台 Host 判断时接管主持权。",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "takeover-fence-input",
    });

    await codex.started;
    await owner.takeoverWorldHost(world.id, {
      clientSessionId: "takeover-fence-session",
    });
    codex.completeTurn();
    await app.worldHostRunner.whenIdle();

    const input = store.db
      .prepare("SELECT status FROM world_inputs WHERE id = ?")
      .get(pending.input.id);
    const judgement = store.db
      .prepare("SELECT id FROM world_judgements WHERE input_id = ?")
      .get(pending.input.id);
    const executor = store.db
      .prepare("SELECT status, last_error FROM world_host_executors WHERE space_id = ?")
      .get(world.id);
    assert.equal(input.status, "pending");
    assert.equal(judgement, undefined);
    assert.equal(executor.status, "failed");
    assert.match(executor.last_error, /execution authority changed/u);
  } finally {
    codex.completeTurn();
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("beta startup prewarms World runtimes without retaining private Host threads", async () => {
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
    assert.equal(codex.created.length, 0);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a ready collective interaction is settled in a fresh isolated World Host thread", async () => {
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
    assert.equal(codex.turns[0].threadId, `thread:${world.id}:1`);
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
