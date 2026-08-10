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
  validateLoopTransitionAgainstDirectorPlan,
  worldHostPrompt,
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
    const contextEnvelope = JSON.parse(prompt.split("\n\n").at(-1));
    const work = contextEnvelope.context_pack;
    const plan = work.director_plan;
    const current = plan?.loop_context?.current_loop;
    const transitionName = plan?.loop_transition_contract?.expected_default;
    const causalTarget = plan?.loop_context?.causal_intersections?.find(
      (candidate) => candidate?.target_loop_id,
    )?.target_loop_id;
    const loopTransition = work.batch_mode
      ? null
      : {
          contract_version: 1,
          loop_id:
            transitionName === "open"
              ? `proposed:${work.input?.id ?? "loop"}`
              : current.id,
          scope: transitionName === "open" ? "personal" : current.scope,
          from_phase: transitionName === "open" ? "none" : current.phase,
          transition: transitionName,
          to_phase: transitionName === "open" ? "active" : current.phase,
          reason: "测试 Host 遵守 Director Runtime v3 Loop 契约。",
          ...(transitionName === "open" ? { title: "继续当前个人经历" } : {}),
          ...(transitionName === "intersect"
            ? { target_loop_id: causalTarget }
            : {}),
        };
    return {
      threadId,
      turnId: `turn:${this.turns.length}`,
      text: JSON.stringify({
        decision: "accepted",
        resolution_disposition: "apply",
        reason_text: "输入符合当前 World 规则。",
        outcome_text: "世界主持已处理该输入。",
        result: {
          resolution: "full_success",
          ...(loopTransition ? { loop_transition: loopTransition } : {}),
          ...(work.batch_mode
            ? {}
            : {
                effects: [],
                affected_entities: [],
                next_affordances: [
                  {
                    label: "继续",
                    event_type: "host.continue",
                    body_text: "继续",
                  },
                ],
              }),
        },
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

class PoisonInputCodexWorldHosts extends FakeCodexWorldHosts {
  async runWorldHostTurn(args) {
    const turn = await super.runWorldHostTurn(args);
    const contextEnvelope = JSON.parse(args.prompt.split("\n\n").at(-1));
    if (contextEnvelope.context_pack.input?.body_text !== "必然失败的结构测试") {
      return turn;
    }
    const decision = JSON.parse(turn.text);
    decision.result.affected_entities = ["character:broken"];
    return { ...turn, text: JSON.stringify(decision) };
  }
}

class PoisonCollectiveCodexWorldHosts extends FakeCodexWorldHosts {
  async runWorldHostTurn(args) {
    const turn = await super.runWorldHostTurn(args);
    const contextEnvelope = JSON.parse(args.prompt.split("\n\n").at(-1));
    if (!contextEnvelope.context_pack.batch_mode) return turn;
    const decision = JSON.parse(turn.text);
    decision.member_state_patch = { forbidden: true };
    return { ...turn, text: JSON.stringify(decision) };
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

async function createPublishedWorld(
  client,
  name,
  marker,
  { initialMemberState = {} } = {},
) {
  const world = await client.createWorld({
    name,
    description: `${name} 的公开说明`,
    rulesText: `只能处理 ${marker} World 内的信息。`,
    definitionText: `隔离标记：${marker}`,
    resolutionMode: "direct",
    initialWorldState: { marker },
    initialMemberState,
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
    assert.doesNotMatch(firstObserved.events.at(-1).body_text, /thread:/u);
    const secondObserved = await submitAndDrain(app, client, second, "celadon");
    assert.doesNotMatch(secondObserved.events.at(-1).body_text, /thread:/u);
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

test("deterministic agency rules override a schema-valid accepting Host", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-agency-"));
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
    const actorRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-agency-actor@example.test",
      displayName: "行动者甲",
      agentProvider: "codex",
    });
    const otherRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-agency-other@example.test",
      displayName: "自主角色乙",
      agentProvider: "other",
    });
    const actor = new AgentWorldClient({
      serverUrl: address.url,
      token: actorRegistration.token,
    });
    const other = new AgentWorldClient({
      serverUrl: address.url,
      token: otherRegistration.token,
    });
    const world = await createPublishedWorld(actor, "自主权世界", "AGENCY_ONLY");
    await other.joinWorld(world.id, { ruleVersion: world.rule_version });
    await actor.enterWorld(world.id, { clientSessionId: "agency-actor" });
    const observed = await actor.observeWorld(world.id);
    const pending = await actor.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "force_other",
      bodyText: "自主角色乙已经同意并离开世界。",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "agency:force-other",
    });
    await app.worldHostRunner.whenIdle();

    assert.equal(codex.turns.length, 1, "the LLM still returned its accepting decision");
    const completed = await actor.worldInputResult(world.id, pending.input.id, {
      waitMs: 0,
    });
    assert.equal(completed.status, "rejected");
    assert.match(completed.host_response.reason_text, /不能替其他角色决定/u);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded Host failures terminalize a poison input and release later work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-poison-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new PoisonInputCodexWorldHosts();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: codex,
    worldHostRetryBaseDelayMs: 10,
    worldHostMaxAttempts: 2,
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-poison@example.test",
      displayName: "失败隔离测试者",
      agentProvider: "codex",
    });
    const client = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const world = await createPublishedWorld(client, "失败隔离世界", "POISON_ONLY");
    await client.enterWorld(world.id, { clientSessionId: "poison-session" });
    let observed = await client.observeWorld(world.id);
    const poison = await client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "inspect",
      bodyText: "必然失败的结构测试",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "poison:input",
    });
    await app.worldHostRunner.whenIdle();

    const failed = await client.worldInputResult(world.id, poison.input.id, {
      waitMs: 2_000,
    });
    await app.worldHostRunner.whenIdle();
    assert.equal(failed.status, "escalated");
    assert.equal(failed.processing.state, "host_failed");
    assert.equal(failed.processing.final, true);
    assert.equal(failed.processing.should_retry, false);
    assert.equal(failed.processing.result_tool, null);
    assert.equal(failed.processing.host_attempt_count, 2);
    assert.match(failed.processing.message, /不会阻塞后续行动/u);
    assert.match(codex.turns[1].prompt, /bounded repair attempt 2 of 2/u);
    assert.match(codex.turns[1].prompt, /affected_entities\[0\] must be a JSON object/u);

    observed = await client.observeWorld(world.id);
    const healthy = await client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "continue",
      bodyText: "继续处理后续的正常行动。",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "poison:follow-up",
    });
    const completed = await client.worldInputResult(world.id, healthy.input.id, {
      waitMs: 2_000,
    });
    assert.equal(completed.processing.state, "completed");
    assert.equal(completed.status, "accepted");

    const rows = store.db
      .prepare(`
        SELECT id, status, host_attempt_count, host_failed_at
        FROM world_inputs WHERE id IN (?, ?) ORDER BY created_at ASC
      `)
      .all(poison.input.id, healthy.input.id);
    assert.deepEqual(rows.map((row) => row.status), ["escalated", "accepted"]);
    assert.equal(rows[0].host_attempt_count, 2);
    assert.ok(rows[0].host_failed_at);
    assert.equal(rows[1].host_attempt_count, 1);
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
    worldHostRetryBaseDelayMs: 10,
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

test("a platform Host automatically retries from fresh context when Host configuration changes mid-turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-config-fence-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new ControlledFakeCodexWorldHosts();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: codex,
    worldHostRetryBaseDelayMs: 10,
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-config-fence@example.test",
      displayName: "Host 配置栅栏测试者",
      agentProvider: "codex",
    });
    const owner = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const world = await createPublishedWorld(owner, "配置栅栏世界", "ORIGINAL_HOST_POLICY");
    await owner.enterWorld(world.id, { clientSessionId: "config-fence-session" });
    const observed = await owner.observeWorld(world.id);
    const pending = await owner.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "inspect",
      bodyText: "在主持配置变化时等待判断。",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "config-fence-input",
    });

    await codex.started;
    const currentHost = await owner.worldHost(world.id);
    await owner.updateWorldHost(world.id, {
      expectedVersion: currentHost.host.version,
      personaText: "UPDATED_HOST_POLICY",
    });
    codex.completeTurn();
    await app.worldHostRunner.whenIdle();

    assert.equal(codex.turns.length, 2);
    assert.doesNotMatch(codex.turns[0].prompt, /UPDATED_HOST_POLICY/u);
    assert.match(codex.turns[1].prompt, /UPDATED_HOST_POLICY/u);
    const input = store.db
      .prepare("SELECT status, host_attempt_count FROM world_inputs WHERE id = ?")
      .get(pending.input.id);
    assert.equal(input.status, "accepted");
    assert.equal(input.host_attempt_count, 2);
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
      {
        initialMemberState: {
          secret: "PRIVATE_MEMBER_STATE_MUST_NOT_REACH_COLLECTIVE_HOST",
        },
      },
    );
    await guest.joinWorld(world.id, { ruleVersion: world.rule_version });
    store.db.prepare("UPDATE pets SET bio = ? WHERE id = ?").run(
      "PRIVATE_BIO_MUST_NOT_REACH_COLLECTIVE_HOST",
      guestRegistration.pet.id,
    );
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
    assert.doesNotMatch(codex.turns[0].prompt, /PRIVATE_BIO_MUST_NOT_REACH/u);
    assert.doesNotMatch(codex.turns[0].prompt, /PRIVATE_MEMBER_STATE_MUST_NOT_REACH/u);
    const publicEvents = await guest.observeWorld(world.id, { afterSequence: 0 });
    assert.doesNotMatch(JSON.stringify(publicEvents), /codex_thread_id|codex_turn_id/u);
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

test("a terminal collective Host failure closes the batch and its pending inputs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-batch-failure-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: new PoisonCollectiveCodexWorldHosts(),
    worldHostMaxAttempts: 1,
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-batch-failure@example.test",
      displayName: "批次失败测试者",
      agentProvider: "codex",
    });
    const guestRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-batch-failure-guest@example.test",
      displayName: "批次失败访客",
      agentProvider: "other",
    });
    const owner = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const guest = new AgentWorldClient({
      serverUrl: address.url,
      token: guestRegistration.token,
    });
    const world = await createPublishedWorld(
      owner,
      "批次失败世界",
      "BATCH_FAILURE_ONLY",
    );
    await guest.joinWorld(world.id, { ruleVersion: world.rule_version });
    await owner.enterWorld(world.id, { clientSessionId: "batch-failure-session" });
    await guest.enterWorld(world.id, { clientSessionId: "batch-failure-guest" });
    await owner.takeoverWorldHost(world.id, {
      clientSessionId: "batch-failure-session",
    });
    const opened = await owner.openWorldHostInteraction(world.id, {
      clientSessionId: "batch-failure-session",
      promptText: "确认执行批次测试？",
      mode: "quorum",
      quorum: 2,
      windowSeconds: 120,
      expectedWorldStateVersion: 1,
    });
    await owner.releaseWorldHost(world.id, {
      clientSessionId: "batch-failure-session",
    });
    let response;
    for (const [client, key] of [[owner, "owner"], [guest, "guest"]]) {
      const observed = await client.observeWorld(world.id);
      const submitted = await client.submitWorldInput(world.id, {
        inputType: "choice",
        eventType: "collective.vote",
        bodyText: "确认。",
        replyToEventId: opened.prompt_event.id,
        visibility: "actor",
        observedWorldStateVersion: observed.world_state.version,
        observedMemberStateVersion: observed.member_state.version,
        idempotencyKey: `batch-failure:${key}`,
      });
      if (key === "owner") response = submitted;
    }
    await app.worldHostRunner.whenIdle();

    const failed = await owner.worldInputResult(world.id, response.input.id, {
      waitMs: 0,
    });
    assert.equal(failed.status, "escalated");
    assert.equal(failed.processing.state, "host_failed");
    assert.equal(failed.processing.final, true);
    const interaction = store.db
      .prepare(`
        SELECT status, host_attempt_count, host_last_error, host_failed_at
        FROM world_interactions WHERE id = ?
      `)
      .get(opened.interaction.id);
    assert.equal(interaction.status, "cancelled");
    assert.equal(interaction.host_attempt_count, 1);
    assert.match(interaction.host_last_error, /cannot include member_state_patch/u);
    assert.ok(interaction.host_failed_at);
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

test("World Host decisions accept the v1 Loop result contract", () => {
  const parsed = parseWorldHostDecision(JSON.stringify({
    decision: "accepted",
    resolution_disposition: "apply",
    reason_text: "行动推进当前个人剧情。",
    outcome_text: "你修好了自己花圃边的篱笆。",
    result: {
      loop_transition: {
        contract_version: 1,
        loop_id: "personal:garden",
        scope: "personal",
        from_phase: "active",
        transition: "continue",
        to_phase: "active",
        reason: "完成一次可逆的个人维护行动。",
      },
      effects: [
        { kind: "entity_state", entity_ref: "garden:a", summary: "篱笆已修复" },
      ],
      affected_entities: [
        { entity_type: "garden", entity_id: "garden:a", effect_kind: "repaired" },
      ],
      impact_hints: [
        { kind: "current_loop_change", urgency: "contextual", reason: "个人目标推进" },
      ],
      next_affordances: [
        { label: "检查花苗", event_type: "garden.inspect", body_text: "检查花苗" },
      ],
    },
  }));
  assert.equal(parsed.loopTransition.transition, "continue");
  assert.equal(parsed.effects.length, 1);
  assert.equal(parsed.nextAffordances.length, 1);
});

test("Director Runtime authorizes resume only from the actor's suspended Loop candidates", () => {
  const directorPlan = {
    loop_context: {
      current_loop: { id: "personal:current", scope: "personal", phase: "active" },
      suspended_loops: [
        { id: "personal:old-branch", scope: "personal", phase: "suspended" },
      ],
    },
    loop_transition_contract: {
      legal_transitions: ["open", "continue", "suspend", "resume", "intersect", "complete"],
      legal_scopes: ["personal", "public", "world"],
      capabilities: {
        open: ["personal"], continue: ["personal", "public", "world"],
        suspend: ["personal", "public", "world"], resume: ["personal", "public", "world"],
        intersect: ["personal", "public", "world"], complete: ["personal", "public", "world"],
      },
    },
  };
  assert.doesNotThrow(() => validateLoopTransitionAgainstDirectorPlan({
    transition: {
      loop_id: "personal:old-branch",
      scope: "personal",
      from_phase: "suspended",
      transition: "resume",
      to_phase: "active",
    },
  }, directorPlan));
  assert.throws(() => validateLoopTransitionAgainstDirectorPlan({
    transition: {
      loop_id: "personal:invented",
      scope: "personal",
      from_phase: "suspended",
      transition: "resume",
      to_phase: "active",
    },
  }, directorPlan), /authorized suspended Loop candidate/u);
});

test("Director Runtime v3 rejects an accepted legacy-shaped result before commit", () => {
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      decision: "accepted",
      resolution_disposition: "apply",
      reason_text: "旧 Host 未返回 Loop 契约。",
      outcome_text: "不应进入提交阶段。",
      result: { resolution: "full_success" },
    }), {
      directorPlan: {
        contract_version: 3,
        loop_transition_contract: {
          required_for_accepted_decision: true,
        },
      },
    }),
    /v3 accepted decision requires result\.loop_transition/u,
  );

  // The same shape remains readable when no v3 plan is attached, preserving
  // already-running v1/v2 Hosts during migration.
  assert.equal(
    parseWorldHostDecision(JSON.stringify({
      decision: "accepted",
      resolution_disposition: "apply",
      reason_text: "旧 Host 兼容读取。",
      outcome_text: "按旧契约返回。",
      result: { resolution: "full_success" },
    })).loopTransition,
    null,
  );
});

test("Loop parser rejects advertised-but-unimplemented transitions and scopes", () => {
  const base = {
    decision: "accepted",
    resolution_disposition: "apply",
    reason_text: "测试假能力。",
    outcome_text: "不应提交。",
    result: {
      effects: [],
      affected_entities: [],
      next_affordances: [{ label: "继续" }],
    },
  };
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: {
        ...base.result,
        loop_transition: {
          contract_version: 1,
          loop_id: "personal:test",
          scope: "personal",
          from_phase: "active",
          transition: "cancel",
          to_phase: "cancelled",
          reason: "运行时未实现。",
        },
      },
    })),
    /Unsupported result\.loop_transition transition/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: {
        ...base.result,
        loop_transition: {
          contract_version: 1,
          loop_id: "relationship:test",
          scope: "relationship",
          from_phase: "active",
          transition: "continue",
          to_phase: "active",
          reason: "运行时未持久化 relationship Loop。",
        },
      },
    })),
    /Unsupported result\.loop_transition scope/u,
  );
});

test("v3 precommit validation binds the proposal to the foreground Loop", () => {
  const decision = {
    decision: "accepted",
    resolution_disposition: "apply",
    reason_text: "尝试切换错误 Loop。",
    outcome_text: "不应提交。",
    result: {
      loop_transition: {
        contract_version: 1,
        loop_id: "loop:global",
        scope: "world",
        from_phase: "open",
        transition: "continue",
        to_phase: "progressing",
        reason: "全局线程试图覆盖个人前台剧情。",
      },
      effects: [],
      affected_entities: [],
      next_affordances: [{ label: "继续" }],
    },
  };
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify(decision), {
      directorPlan: {
        contract_version: 3,
        loop_context: {
          current_loop: {
            id: "loop:personal",
            scope: "personal",
            phase: "active",
          },
          causal_intersections: [],
        },
        loop_transition_contract: {
          required_for_accepted_decision: true,
          legal_transitions: ["continue"],
          legal_scopes: ["personal", "public", "world"],
          capabilities: {
            continue: ["personal", "public", "world"],
          },
        },
      },
    }),
    /loop_id must match the foreground Loop/u,
  );
});

test("World Host cannot select semantic delivery recipients", () => {
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      decision: "accepted",
      resolution_disposition: "apply",
      reason_text: "尝试越权投递。",
      outcome_text: "行动已结算。",
      result: {
        loop_transition: {
          contract_version: 1,
          loop_id: "personal:well",
          scope: "personal",
          from_phase: "active",
          transition: "intersect",
          to_phase: "active",
          reason: "共享水井发生因果交叉。",
          target_loop_id: "loop:shared-well",
        },
        effects: [],
        affected_entities: [],
        impact_hints: [
          { kind: "direct", recipient_id: "character:b", reason: "Host 指定" },
        ],
        next_affordances: [{ label: "继续", body_text: "继续" }],
      },
    })),
    /outside World Host delivery authority/u,
  );
});

test("World Host prompt treats causal overlap, not presence, as multiplayer evidence", () => {
  const prompt = worldHostPrompt({
    bound_world_id: "world-loop",
    director_plan: {
      loop_context: {
        intersection_state: "independent",
        causal_intersections: [],
      },
    },
  });
  assert.match(prompt, /Presence alone must never force multiplayer interaction/u);
  assert.match(prompt, /server impact router alone determines recipients/u);
  assert.match(prompt, /result\.loop_transition is required/u);
  assert.match(prompt, /Every item in all three arrays must be a JSON object/u);
  assert.match(prompt, /affected_entities items shaped like \{ entity_type, entity_id, effect_kind \}/u);
  assert.match(prompt, /next_affordances items shaped like \{ label, input_type, event_type, body_text, visibility \}/u);
  assert.match(prompt, /copy its id and claim text exactly/u);
  assert.match(prompt, /may only advance metadata such as status or confirmations/u);
});

test("Loop parser rejects bare string affected entities and affordances", () => {
  const base = {
    decision: "accepted",
    resolution_disposition: "apply",
    reason_text: "验证结构化结果。",
    outcome_text: "不应提交格式错误的裁决。",
    result: {
      loop_transition: {
        contract_version: 1,
        loop_id: "personal:test",
        scope: "personal",
        from_phase: "active",
        transition: "continue",
        to_phase: "active",
        reason: "测试结构校验。",
      },
      effects: [],
      affected_entities: [{ entity_type: "character", entity_id: "character:a" }],
      next_affordances: [{ label: "继续" }],
    },
  };
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: { ...base.result, affected_entities: ["character:a"] },
    })),
    /affected_entities\[0\] must be a JSON object/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: { ...base.result, next_affordances: ["继续"] },
    })),
    /next_affordances\[0\] must be a JSON object/u,
  );
});
