import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    const inputText = work.input?.body_text ?? "本轮共同决定";
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
        outcome_text: work.batch_mode
          ? "参与者意见存在分歧；世界主持已按公开协调规则记录共同结果。"
          : `你尝试“${inputText}”后，眼前出现了可以继续确认的具体变化。`,
        result: {
          resolution: "full_success",
          ...(loopTransition ? { loop_transition: loopTransition } : {}),
          ...(work.batch_mode
            ? {
                effects: [{ kind: "collective_record", summary: "本轮共同结果已写入现场记录。" }],
                affected_entities: [{ entity_type: "world", entity_id: work.bound_world_id, effect_kind: "collective_recorded" }],
                next_affordances: [{ label: "查看共同结果记录", input_type: "action", event_type: "host.inspect_result", body_text: "我查看本轮共同结果写入的现场记录。", visibility: "world" }],
                collective_semantics: {
                  unanimous: false,
                  material_disagreement: true,
                  choice_counts: { left: 1, right: 1 },
                },
              }
            : {
                effects: [{ kind: "world_trace", summary: `“${inputText}”让眼前留下了可见痕迹。` }],
                affected_entities: [{ entity_type: "world", entity_id: work.bound_world_id, effect_kind: "changed" }],
                next_affordances: [
                  {
                    label: `检查与“${inputText}”有关的痕迹`,
                    input_type: "action",
                    event_type: "host.inspect_trace",
                    body_text: `我检查“${inputText}”之后留下的可见痕迹。`,
                    visibility: "world",
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

class FakeHostExecutor {
  constructor({
    reuseContext = false,
    wrongWorld = false,
    missingContextId = false,
    invalidContextId = null,
    invalidExecution = false,
    failPrepareOnce = false,
    hangPrepare = false,
    hangExecute = false,
    closeRejects = false,
  } = {}) {
    this.id = "test_remote";
    this.contextIsolation = "per_turn";
    this.reuseContext = reuseContext;
    this.wrongWorld = wrongWorld;
    this.missingContextId = missingContextId;
    this.invalidContextId = invalidContextId;
    this.invalidExecution = invalidExecution;
    this.failPrepareOnce = failPrepareOnce;
    this.hangPrepare = hangPrepare;
    this.hangExecute = hangExecute;
    this.closeRejects = closeRejects;
    this.delegate = new FakeCodexWorldHosts();
    this.prepared = [];
    this.executed = [];
    this.closed = false;
    this.executionStarted = new Promise((resolveStarted) => {
      this.resolveExecutionStarted = resolveStarted;
    });
  }

  bindingMetadata() {
    return {
      executor_type: this.id,
      context_isolation: "one_fresh_execution_context_per_turn",
    };
  }

  async prepareTurn({ worldId, worldName }) {
    if (this.failPrepareOnce && this.prepared.length === 0) {
      this.prepared.push({ worldId, worldName, context: null });
      throw new Error("transient prepare failure");
    }
    if (this.hangPrepare) return new Promise(() => {});
    const id = this.invalidContextId === "blank"
      ? " "
      : this.invalidContextId === "object"
        ? {}
        : this.missingContextId
      ? undefined
      : this.reuseContext
        ? "remote-context:reused"
        : `remote-context:${this.prepared.length + 1}`;
    const context = {
      id,
      worldId: this.wrongWorld ? "world:wrong" : worldId,
    };
    this.prepared.push({ worldId, worldName, context });
    return context;
  }

  async executeTurn({ context, prompt }) {
    this.executed.push({ context, prompt });
    this.resolveExecutionStarted();
    if (this.hangExecute) return new Promise(() => {});
    if (this.invalidExecution) return { id: null, text: null };
    const turn = await this.delegate.runWorldHostTurn({
      threadId: context.id,
      prompt,
      resume: false,
    });
    return { id: turn.turnId, text: turn.text };
  }

  async close() {
    this.closed = true;
    if (this.closeRejects) throw new Error("executor close failed");
  }
}

class SyncThrowingCloseHostExecutor extends FakeHostExecutor {
  close() {
    this.closed = true;
    throw new Error("executor close synchronously failed");
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

class GenericGroundingCodexWorldHosts extends FakeCodexWorldHosts {
  async runWorldHostTurn(args) {
    const turn = await super.runWorldHostTurn(args);
    const contextEnvelope = JSON.parse(args.prompt.split("\n\n").at(-1));
    const work = contextEnvelope.context_pack;
    if (work.input?.body_text !== "我用铜钩捞起井底的蓝色布包。") return turn;
    const decision = JSON.parse(turn.text);
    decision.reason_text = "输入符合规则。";
    decision.outcome_text = "远处的风铃响起，柜台上露出一本沾灰的账册。";
    decision.result.effects = [{ kind: "reveal", summary: "柜台上多出一本沾灰的账册。" }];
    decision.result.affected_entities = [{ entity_type: "object", entity_id: "dusty-ledger", effect_kind: "revealed" }];
    decision.result.next_affordances = [{ label: "翻看沾灰的账册", input_type: "action", event_type: "ledger.inspect", body_text: "我翻看柜台上沾灰的账册。", visibility: "world" }];
    return { ...turn, text: JSON.stringify(decision) };
  }
}

class VacuousConsequenceCodexWorldHosts extends FakeCodexWorldHosts {
  async runWorldHostTurn(args) {
    const turn = await super.runWorldHostTurn(args);
    const contextEnvelope = JSON.parse(args.prompt.split("\n\n").at(-1));
    const work = contextEnvelope.context_pack;
    if (work.input?.body_text !== "我用铜钩捞起井底的蓝色布包。") return turn;
    const decision = JSON.parse(turn.text);
    decision.reason_text = "输入符合规则。";
    decision.outcome_text = "蓝色布包的状态已经更新。";
    decision.result.effects = [{ kind: "state", summary: "蓝色布包已有变化。" }];
    decision.result.affected_entities = [{ entity_type: "object", entity_id: "blue-cloth-bundle", effect_kind: "changed" }];
    decision.result.next_affordances = [{ label: "检查蓝色布包状态", input_type: "action", event_type: "bundle.inspect", body_text: "我检查蓝色布包的状态。", visibility: "world" }];
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
    assert.throws(
      () => new LocalCodexWorldHostRunner({
        db: store.db,
        codexClient: new FakeCodexWorldHosts(),
        executionTimeoutMs: 0,
      }),
      /executionTimeoutMs must be between 10 and 600000/u,
    );
    assert.throws(
      () => new LocalCodexWorldHostRunner({
        db: store.db,
        codexClient: new FakeCodexWorldHosts(),
        closeTimeoutMs: 0,
      }),
      /closeTimeoutMs must be between 10 and 60000/u,
    );
  } finally {
    store.close();
  }
});

test("a HostExecutor cannot be injected while the deterministic rollback mode is active", () => {
  const store = new PetSocialStore(":memory:");
  try {
    assert.throws(
      () => createAgentWorldApp({ store, worldHostExecutor: new FakeHostExecutor() }),
      /worldHostExecutor requires worldHostMode=local_codex/u,
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

test("an injected HostExecutor runs end to end with fresh World-bound contexts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-injection-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const executor = new FakeHostExecutor();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
    worldHostCodexClient: {
      async createWorldHostThread() {
        throw new Error("the default Codex client must not be called");
      },
    },
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-executor-injection@example.test",
      displayName: "执行器注入测试者",
      agentProvider: "other",
    });
    const client = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const world = await createPublishedWorld(client, "执行器边界世界", "EXECUTOR_ONLY");

    await submitAndDrain(app, client, world, "executor-one");
    await submitAndDrain(app, client, world, "executor-two");

    assert.equal(executor.prepared.length, 2);
    assert.equal(executor.executed.length, 2);
    assert.equal(new Set(executor.prepared.map((item) => item.context.id)).size, 2);
    assert.ok(executor.prepared.every((item) => item.worldId === world.id));
    assert.deepEqual(
      executor.executed.map((item) => item.context.id),
      executor.prepared.map((item) => item.context.id),
    );
    assert.ok(executor.executed.every((item) => item.prompt.includes("EXECUTOR_ONLY")));

    const row = store.db
      .prepare(`
        SELECT codex_thread_id, last_turn_id, status
        FROM world_host_executors WHERE space_id = ?
      `)
      .get(world.id);
    assert.equal(row.codex_thread_id, "remote-context:2");
    assert.equal(row.last_turn_id, "turn:2");
    assert.equal(row.status, "idle");
  } finally {
    await app.close();
    assert.equal(executor.closed, true);
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the scheduler rejects observable Host execution context reuse before prompt disclosure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-reuse-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const executor = new FakeHostExecutor({ reuseContext: true });
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
    worldHostMaxAttempts: 1,
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-executor-reuse@example.test",
      displayName: "执行器复用测试者",
      agentProvider: "other",
    });
    const client = new AgentWorldClient({
      serverUrl: address.url,
      token: registration.token,
    });
    const world = await createPublishedWorld(client, "执行器复用世界", "REUSE_ONLY");
    await submitAndDrain(app, client, world, "reuse-first");

    await client.enterWorld(world.id, { clientSessionId: "session:reuse-second" });
    const observed = await client.observeWorld(world.id);
    const pending = await client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "speak",
      bodyText: "触发第二轮执行器上下文",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "input:reuse-second",
    });
    await app.worldHostRunner.whenIdle();

    const completed = await client.worldInputResult(world.id, pending.input.id, {
      waitMs: 0,
    });
    assert.equal(completed.processing.state, "host_failed");
    const audit = store.db
      .prepare("SELECT last_error FROM world_host_executors WHERE space_id = ?")
      .get(world.id);
    assert.match(audit.last_error, /reused a persisted execution context/u);
    assert.equal(executor.executed.length, 1, "the reused context receives no prompt");
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the scheduler rejects a Host context id persisted by an earlier runner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-persisted-reuse-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const executor = new FakeHostExecutor({ reuseContext: true });
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
    worldHostMaxAttempts: 1,
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-executor-persisted-reuse@example.test",
      displayName: "持久化复用测试者",
      agentProvider: "other",
    });
    const client = new AgentWorldClient({ serverUrl: address.url, token: registration.token });
    const world = await createPublishedWorld(client, "持久化复用世界", "PERSISTED_REUSE_ONLY");
    store.db
      .prepare(`
        INSERT INTO world_host_execution_contexts (
          context_fingerprint, executor_type, world_fingerprint, created_at
        ) VALUES (?, ?, ?, ?)
      `)
      .run(
        createHash("sha256").update("remote-context:reused").digest("hex"),
        "test_remote",
        createHash("sha256").update("world:earlier").digest("hex"),
        new Date().toISOString(),
      );

    await client.enterWorld(world.id, { clientSessionId: "session:persisted-reuse" });
    const observed = await client.observeWorld(world.id);
    const pending = await client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "speak",
      bodyText: "触发持久化上下文复用检查",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "input:persisted-reuse",
    });
    await app.worldHostRunner.whenIdle();

    const completed = await client.worldInputResult(world.id, pending.input.id, { waitMs: 0 });
    const audit = store.db
      .prepare("SELECT last_error FROM world_host_executors WHERE space_id = ?")
      .get(world.id);
    assert.equal(completed.processing.state, "host_failed");
    assert.match(audit.last_error, /reused a persisted execution context/u);
    assert.equal(executor.executed.length, 0, "a persisted context receives no prompt");
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "a missing context id",
    options: { missingContextId: true },
    error: /prepareTurn returned an invalid context/u,
    executed: 0,
  },
  {
    name: "a context bound to another World",
    options: { wrongWorld: true },
    error: /prepareTurn returned an invalid context/u,
    executed: 0,
  },
  {
    name: "a blank context id",
    options: { invalidContextId: "blank" },
    error: /prepareTurn returned an invalid context/u,
    executed: 0,
  },
  {
    name: "a non-string context id",
    options: { invalidContextId: "object" },
    error: /prepareTurn returned an invalid context/u,
    executed: 0,
  },
  {
    name: "an invalid execution result",
    options: { invalidExecution: true },
    error: /executeTurn returned an invalid result/u,
    executed: 1,
  },
]) {
  test(`the scheduler terminalizes ${scenario.name} without committing state`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-contract-"));
    const store = new PetSocialStore(join(directory, "social.sqlite"));
    const executor = new FakeHostExecutor(scenario.options);
    const app = createAgentWorldApp({
      store,
      worldHostMode: "local_codex",
      worldHostExecutor: executor,
      worldHostMaxAttempts: 1,
    });
    const address = await app.listen();
    try {
      const registration = await AgentWorldClient.register(address.url, {
        recoveryEmail: `${scenario.name.replaceAll(" ", "-")}@example.test`,
        displayName: "执行器契约测试者",
        agentProvider: "other",
      });
      const client = new AgentWorldClient({
        serverUrl: address.url,
        token: registration.token,
      });
      const world = await createPublishedWorld(client, "执行器契约世界", "CONTRACT_ONLY");
      await client.enterWorld(world.id, { clientSessionId: "session:contract" });
      const before = await client.observeWorld(world.id);
      const pending = await client.submitWorldInput(world.id, {
        inputType: "speech",
        eventType: "speak",
        bodyText: "触发执行器契约校验",
        observedWorldStateVersion: before.world_state.version,
        observedMemberStateVersion: before.member_state.version,
        idempotencyKey: `input:${scenario.name}`,
      });
      await app.worldHostRunner.whenIdle();

      const completed = await client.worldInputResult(world.id, pending.input.id, { waitMs: 0 });
      const after = await client.observeWorld(world.id);
      const audit = store.db
        .prepare("SELECT last_error FROM world_host_executors WHERE space_id = ?")
        .get(world.id);
      assert.equal(completed.processing.state, "host_failed");
      assert.equal(after.world_state.version, before.world_state.version);
      assert.match(audit.last_error, scenario.error);
      assert.equal(executor.executed.length, scenario.executed);
    } finally {
      await app.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("a transient custom executor failure retries with a fresh context", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-transient-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const executor = new FakeHostExecutor({ failPrepareOnce: true });
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
    worldHostMaxAttempts: 2,
    worldHostRetryBaseDelayMs: 0,
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-executor-transient@example.test",
      displayName: "执行器重试测试者",
      agentProvider: "other",
    });
    const client = new AgentWorldClient({ serverUrl: address.url, token: registration.token });
    const world = await createPublishedWorld(client, "执行器重试世界", "TRANSIENT_ONLY");
    await submitAndDrain(app, client, world, "transient-retry");

    assert.equal(executor.prepared.length, 2);
    assert.equal(executor.executed.length, 1);
    assert.equal(executor.executed[0].context.id, "remote-context:2");
    const input = store.db
      .prepare("SELECT status, host_attempt_count FROM world_inputs WHERE space_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(world.id);
    assert.equal(input.status, "accepted");
    assert.equal(input.host_attempt_count, 2);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a custom executor prepare timeout terminalizes safely", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-timeout-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const executor = new FakeHostExecutor({ hangPrepare: true });
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
    worldHostMaxAttempts: 1,
    worldHostExecutionTimeoutMs: 20,
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-executor-timeout@example.test",
      displayName: "执行器超时测试者",
      agentProvider: "other",
    });
    const client = new AgentWorldClient({ serverUrl: address.url, token: registration.token });
    const world = await createPublishedWorld(client, "执行器超时世界", "TIMEOUT_ONLY");
    await client.enterWorld(world.id, { clientSessionId: "session:timeout" });
    const observed = await client.observeWorld(world.id);
    const pending = await client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "speak",
      bodyText: "触发执行器超时",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "input:timeout",
    });
    await app.worldHostRunner.whenIdle();

    const completed = await client.worldInputResult(world.id, pending.input.id, { waitMs: 0 });
    const audit = store.db
      .prepare("SELECT last_error FROM world_host_executors WHERE space_id = ?")
      .get(world.id);
    assert.equal(completed.processing.state, "host_failed");
    assert.match(audit.last_error, /prepareTurn timed out/u);
    assert.equal(executor.executed.length, 0);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("closing aborts a hanging executor turn without consuming an attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-abort-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const executor = new FakeHostExecutor({ hangExecute: true });
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
    worldHostExecutionTimeoutMs: 60_000,
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-executor-abort@example.test",
      displayName: "执行器关闭测试者",
      agentProvider: "other",
    });
    const client = new AgentWorldClient({ serverUrl: address.url, token: registration.token });
    const world = await createPublishedWorld(client, "执行器关闭世界", "ABORT_ONLY");
    await client.enterWorld(world.id, { clientSessionId: "session:abort" });
    const observed = await client.observeWorld(world.id);
    const pending = await client.submitWorldInput(world.id, {
      inputType: "speech",
      eventType: "speak",
      bodyText: "触发挂起的执行器",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "input:abort",
    });
    await executor.executionStarted;
    await app.close();

    const input = store.db
      .prepare("SELECT status, host_attempt_count FROM world_inputs WHERE id = ?")
      .get(pending.input.id);
    assert.equal(input.status, "pending");
    assert.equal(input.host_attempt_count, 0);
    assert.equal(executor.closed, true);
  } finally {
    if (app.server.listening) await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("application resources close even when executor.close rejects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-close-error-"));
  const databaseFile = join(directory, "social.sqlite");
  const executor = new FakeHostExecutor({ closeRejects: true });
  const app = createAgentWorldApp({
    databaseFile,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
  });
  await app.listen();
  try {
    await assert.rejects(() => app.close(), /executor close failed/u);
    assert.equal(app.server.listening, false);
    assert.throws(() => app.store.db.prepare("SELECT 1").get());
  } finally {
    if (app.server.listening) await new Promise((resolve) => app.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("application resources close even when executor.close throws synchronously", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-sync-close-error-"));
  const databaseFile = join(directory, "social.sqlite");
  const executor = new SyncThrowingCloseHostExecutor();
  const app = createAgentWorldApp({
    databaseFile,
    worldHostMode: "local_codex",
    worldHostExecutor: executor,
  });
  await app.listen();
  try {
    await assert.rejects(() => app.close(), /executor close synchronously failed/u);
    assert.equal(executor.closed, true);
    assert.equal(app.server.listening, false);
    assert.throws(() => app.store.db.prepare("SELECT 1").get());
  } finally {
    if (app.server.listening) await new Promise((resolve) => app.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy executor context ids are backfilled as irreversible tombstones", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-executor-backfill-"));
  const databaseFile = join(directory, "social.sqlite");
  let store = new PetSocialStore(databaseFile);
  const codex = new FakeCodexWorldHosts();
  const app = createAgentWorldApp({
    store,
    worldHostMode: "local_codex",
    worldHostCodexClient: codex,
    worldHostRoot: join(directory, "hosts"),
  });
  const address = await app.listen();
  try {
    const registration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "host-executor-backfill@example.test",
      displayName: "执行器迁移测试者",
      agentProvider: "codex",
    });
    const client = new AgentWorldClient({ serverUrl: address.url, token: registration.token });
    const world = await createPublishedWorld(client, "执行器迁移世界", "BACKFILL_ONLY");
    await submitAndDrain(app, client, world, "backfill");
    const contextId = store.db
      .prepare("SELECT codex_thread_id FROM world_host_executors WHERE space_id = ?")
      .get(world.id).codex_thread_id;
    store.db.exec("DROP TABLE world_host_execution_contexts");
    await app.close();
    store.close();

    store = new PetSocialStore(databaseFile);
    const tombstone = store.db
      .prepare("SELECT * FROM world_host_execution_contexts")
      .get();
    assert.equal(
      tombstone.context_fingerprint,
      createHash("sha256").update(contextId).digest("hex"),
    );
    assert.equal(tombstone.executor_type, "local_codex");
    assert.equal(JSON.stringify(tombstone).includes(contextId), false);
  } finally {
    if (app.server.listening) await app.close();
    try {
      store.close();
    } catch {}
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
    assert.match(completed.host_response.outcome_text, /检查回声来自哪里/u);
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
    assert.equal(failed.processing.error, "Host 暂时无法完成这次处理；行动已安全记录。");
    assert.doesNotMatch(JSON.stringify(failed.processing), /affected_entities|JSON object|schema/i);
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

test("live Host runner bounded-retries a structurally valid but ungrounded outcome", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-grounding-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new GenericGroundingCodexWorldHosts();
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
      recoveryEmail: "host-grounding@example.test",
      displayName: "具体结果验收者",
      agentProvider: "codex",
    });
    const client = new AgentWorldClient({ serverUrl: address.url, token: registration.token });
    const world = await createPublishedWorld(client, "琥珀世界", "GROUNDING_ONLY");
    await client.enterWorld(world.id, { clientSessionId: "grounding-session" });
    const observed = await client.observeWorld(world.id);
    const pending = await client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "well.retrieve_bundle",
      bodyText: "我用铜钩捞起井底的蓝色布包。",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "grounding:generic-outcome",
    });
    const failed = await client.worldInputResult(world.id, pending.input.id, { waitMs: 2_000 });
    await app.worldHostRunner.whenIdle();
    assert.equal(failed.processing.state, "host_failed");
    assert.equal(failed.processing.host_attempt_count, 2);
    assert.equal(codex.turns.length, 2);
    assert.match(codex.turns[1].prompt, /bounded repair attempt 2 of 2/u);
    assert.match(codex.turns[1].prompt, /must name a concrete entity or fact/u);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live Host runner bounded-retries an entity-grounded but consequence-free outcome", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-host-consequence-"));
  const store = new PetSocialStore(join(directory, "social.sqlite"));
  const codex = new VacuousConsequenceCodexWorldHosts();
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
      recoveryEmail: "host-consequence@example.test",
      displayName: "可感知后果验收者",
      agentProvider: "codex",
    });
    const client = new AgentWorldClient({ serverUrl: address.url, token: registration.token });
    const world = await createPublishedWorld(client, "琥珀世界", "CONSEQUENCE_ONLY");
    await client.enterWorld(world.id, { clientSessionId: "consequence-session" });
    const observed = await client.observeWorld(world.id);
    const pending = await client.submitWorldInput(world.id, {
      inputType: "action",
      eventType: "well.retrieve_bundle",
      bodyText: "我用铜钩捞起井底的蓝色布包。",
      observedWorldStateVersion: observed.world_state.version,
      observedMemberStateVersion: observed.member_state.version,
      idempotencyKey: "consequence:empty-outcome",
    });
    const failed = await client.worldInputResult(world.id, pending.input.id, { waitMs: 2_000 });
    await app.worldHostRunner.whenIdle();
    assert.equal(failed.processing.state, "host_failed");
    assert.equal(failed.processing.host_attempt_count, 2);
    assert.equal(codex.turns.length, 2);
    assert.match(codex.turns[1].prompt, /bounded repair attempt 2 of 2/u);
    assert.match(codex.turns[1].prompt, /status update alone is not a consequence/u);
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
      choiceOptions: [{ choice_id: "left", label: "左路" }, { choice_id: "right", label: "右路" }],
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
        data: { choice_id: key === "owner" ? "left" : "right" },
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
      choiceOptions: [{ choice_id: "confirm", label: "确认执行" }],
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
        data: { choice_id: "confirm" },
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

test("accepted Host decisions enforce player-facing consequences and hide runtime terms", () => {
  const base = {
    decision: "accepted",
    resolution_disposition: "apply",
    reason_text: "你的行动符合眼前的规则。",
    outcome_text: "木门被你推开，里面的风铃响了一声，柜台后露出一封未寄出的信。",
    result: {
      loop_transition: {
        contract_version: 1,
        loop_id: "personal:shop",
        scope: "personal",
        from_phase: "active",
        transition: "continue",
        to_phase: "active",
        reason: "柜台后的新发现让你可以继续调查。",
      },
      effects: [{ kind: "new_clue", summary: "发现一封未寄出的信。" }],
      affected_entities: [{ entity_type: "location", entity_id: "shop:counter", effect_kind: "revealed" }],
      next_affordances: [{ label: "查看未寄出的信", input_type: "action", event_type: "shop.inspect_letter", body_text: "我拿起柜台后的未寄出的信，查看收件人和日期。", visibility: "world" }],
    },
  };
  assert.doesNotThrow(() => parseWorldHostDecision(JSON.stringify(base), { requireLoopContract: true }));
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      outcome_text: "world_progress 已更新。",
    }), { requireLoopContract: true }),
    /must not expose World Host internal terminology/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: { ...base.result, effects: [] },
    }), { requireLoopContract: true }),
    /result\.effects must contain 1-50 items/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: { ...base.result, effects: [{}] },
    }), { requireLoopContract: true }),
    /result\.effects\[0\]\.kind must be a string/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: {
        ...base.result,
        next_affordances: [
          ...base.result.next_affordances,
          { label: "离开", event_type: "leave", body_text: "我离开这里。" },
          { label: "等待", event_type: "wait", body_text: "我先在这里等待。" },
          { label: "记录", event_type: "note", body_text: "我把眼前的变化记下来。" },
        ],
      },
    }), { requireLoopContract: true }),
    /result\.next_affordances must contain 1-3 items/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: {
        ...base.result,
        next_affordances: [{ label: "继续", input_type: "action", event_type: "continue", body_text: "继续", visibility: "world" }],
      },
    }), { requireLoopContract: true }),
    /concrete fact, effect, hook, or affected entity/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      result: { ...base.result, next_affordances: [{ label: "检查远处码头", input_type: "action", event_type: "harbor.inspect", body_text: "我检查远处码头。", visibility: "world" }] },
    }), { requireLoopContract: true }),
    /concrete fact, effect, hook, or affected entity/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...base,
      reason_text: "输入符合规则。",
      outcome_text: "世界主持已经处理了这次行动，现场留下了可见痕迹。",
      result: {
        ...base.result,
        effects: [{ kind: "trace", summary: "现场留下了可见痕迹。" }],
        affected_entities: [{ entity_type: "world", entity_id: "world:test", effect_kind: "changed" }],
        next_affordances: [{ label: "检查现场痕迹", input_type: "action", event_type: "inspect", body_text: "我检查现场留下的痕迹。", visibility: "world" }],
      },
    }), {
      requireLoopContract: true,
      groundingContext: {
        input: { body_text: "我登上渡船查看驾驶舱里的航海日志。" },
        world: { name: "雨港修船铺", description: "船坞里停着一艘漏水小船。" },
      },
    }),
    /(?:must name a concrete entity or fact|status update alone is not a consequence)/u,
  );
  const genericAmberDecision = {
    ...base,
    reason_text: "输入符合规则。",
    outcome_text: "琥珀世界的现场状态已经发生了具体变化。",
    result: {
      ...base.result,
      effects: [{ kind: "state", summary: "现场状态已经更新。" }],
      affected_entities: [{ entity_type: "scene", entity_id: "scene:current", effect_kind: "changed" }],
      next_affordances: [{ label: "检查现场状态", input_type: "action", event_type: "scene.inspect", body_text: "我检查现场状态。", visibility: "world" }],
    },
  };
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...genericAmberDecision,
      outcome_text: "蓝色布包的状态已经更新。",
      result: {
        ...genericAmberDecision.result,
        effects: [{ kind: "state", summary: "蓝色布包已有变化。" }],
        affected_entities: [{ entity_type: "object", entity_id: "blue-cloth-bundle", effect_kind: "changed" }],
        next_affordances: [{ label: "检查蓝色布包状态", input_type: "action", event_type: "bundle.inspect", body_text: "我检查蓝色布包的状态。", visibility: "world" }],
      },
    }), {
      requireLoopContract: true,
      groundingContext: {
        input: { body_text: "我用铜钩捞起井底的蓝色布包。" },
        world: { name: "琥珀世界" },
      },
    }),
    /status update alone is not a consequence/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify(genericAmberDecision), {
      requireLoopContract: true,
      groundingContext: {
        input: { body_text: "我用铜钩捞起井底的蓝色布包。" },
        world: { name: "琥珀世界" },
      },
    }),
    /(?:must name a concrete entity or fact|status update alone is not a consequence)/u,
  );
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({
      ...genericAmberDecision,
      outcome_text: "琥珀世界已经回应了你的行动。",
      result: {
        ...genericAmberDecision.result,
        effects: [{ kind: "state", summary: "琥珀世界已经发生变化。" }],
        next_affordances: [{ label: "继续探索琥珀世界", input_type: "action", event_type: "world.explore", body_text: "我继续探索琥珀世界。", visibility: "world" }],
      },
    }), {
      requireLoopContract: true,
      groundingContext: {
        input: { body_text: "我用铜钩捞起井底的蓝色布包。" },
        world: { name: "琥珀世界" },
      },
    }),
    /(?:must name a concrete entity or fact|status update alone is not a consequence)/u,
  );
  assert.doesNotThrow(
    () => parseWorldHostDecision(JSON.stringify({
      ...genericAmberDecision,
      outcome_text: "铜钩勾住蓝色布包的绑绳，你把仍在滴水的布包拖到了井沿。",
      result: {
        ...genericAmberDecision.result,
        effects: [{ kind: "retrieval", summary: "蓝色布包已经离开井水，绑绳上粘着黑色苔藓。" }],
        affected_entities: [{ entity_type: "object", entity_id: "blue-cloth-bundle", effect_kind: "retrieved" }],
        next_affordances: [{ label: "检查布包上的黑色苔藓", input_type: "action", event_type: "bundle.inspect_moss", body_text: "我检查蓝色布包绑绳上的黑色苔藓。", visibility: "world" }],
      },
    }), {
      requireLoopContract: true,
      groundingContext: {
        input: { body_text: "我用铜钩捞起井底的蓝色布包。" },
        world: { name: "琥珀世界" },
      },
    }),
  );
  assert.doesNotThrow(
    () => parseWorldHostDecision(JSON.stringify(base), {
      requireLoopContract: true,
      groundingContext: {
        input: { body_text: "我推开木门，查看柜台后的东西。" },
        world: { name: "旧信铺", description: "门后挂着风铃。" },
      },
    }),
  );
});

test("non-accepted Host decisions allow only player-facing, grounded repair affordances", () => {
  const base = {
    decision: "clarification",
    resolution_disposition: "apply",
    reason_text: "信封上的收件人尚未确定。",
    outcome_text: "你发现柜台后的信封没有署名，暂时无法投递。",
    result: {
      new_facts: ["信封没有署名。"],
      repair_affordances: [{ label: "检查没有署名的信封", input_type: "action", event_type: "shop.inspect_envelope", body_text: "我仔细检查这只没有署名的信封的封口和背面。", visibility: "world" }],
    },
  };
  assert.doesNotThrow(() => parseWorldHostDecision(JSON.stringify(base), { requireLoopContract: true }));
  assert.throws(
    () => parseWorldHostDecision(JSON.stringify({ ...base, result: { ...base.result, repair_affordances: [{ ...base.result.repair_affordances[0], label: "下一步", body_text: "下一步" }] } }), { requireLoopContract: true }),
    /concrete fact, effect, hook, or affected entity/u,
  );
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
