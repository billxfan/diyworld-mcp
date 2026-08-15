import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertHostExecutor,
  HostExecutor,
  LocalCodexHostExecutor,
} from "../src/world-host-executor.mjs";

test("HostExecutor defines the executor-neutral per-turn contract", async () => {
  const executor = new HostExecutor({ id: "test" });
  assert.deepEqual(executor.bindingMetadata(), {
    executor_type: "test",
    context_isolation: "one_fresh_execution_context_per_turn",
  });
  await assert.rejects(() => executor.prepareTurn(), /does not implement prepareTurn/u);
  await assert.rejects(() => executor.executeTurn(), /does not implement executeTurn/u);
  assert.equal(assertHostExecutor(executor), executor);
});

test("HostExecutor rejects invalid identities, isolation, and incomplete adapters", () => {
  assert.throws(() => new HostExecutor(), /id is required/u);
  assert.throws(() => new HostExecutor({ id: " " }), /id is required/u);
  assert.throws(() => new HostExecutor({ id: "x".repeat(129) }), /id is required/u);
  assert.throws(
    () => new HostExecutor({ id: "wrong-isolation", contextIsolation: "per_world" }),
    /contextIsolation must be per_turn/u,
  );
  assert.throws(() => assertHostExecutor(null), /HostExecutor is required/u);
  assert.throws(
    () => assertHostExecutor({ id: "", contextIsolation: "per_turn" }),
    /id must be a non-empty string/u,
  );
  assert.throws(
    () => assertHostExecutor({ id: "broken", contextIsolation: "per_world" }),
    /contextIsolation must be per_turn/u,
  );
  assert.throws(
    () => assertHostExecutor({ id: "broken", contextIsolation: "per_turn" }),
    /bindingMetadata must be a function/u,
  );
});

test("LocalCodexHostExecutor implements the contract with a fresh isolated turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "diyworld-host-executor-"));
  const calls = [];
  let closed = false;
  const codexClient = {
    async createWorldHostThread(args) {
      calls.push({ kind: "prepare", args });
      return { id: "thread:one" };
    },
    async runWorldHostTurn(args) {
      calls.push({ kind: "execute", args });
      return { turnId: "turn:one", text: "{}" };
    },
    close() {
      closed = true;
    },
  };
  const executor = new LocalCodexHostExecutor({
    codexClient,
    hostRoot: directory,
    model: "test-model",
    effort: "low",
  });
  try {
    assert.deepEqual(executor.bindingMetadata(), {
      executor_type: "local_codex",
      context_isolation: "one_fresh_thread_per_turn",
    });
    const context = await executor.prepareTurn({
      worldId: "world/one",
      worldName: "测试世界",
    });
    const result = await executor.executeTurn({ context, prompt: "host prompt" });
    assert.equal(context.id, "thread:one");
    assert.equal(context.worldId, "world/one");
    assert.deepEqual(result, {
      id: "turn:one",
      text: "{}",
      raw: { turnId: "turn:one", text: "{}" },
    });
    assert.equal(calls[0].args.ephemeral, true);
    assert.equal(calls[1].args.threadId, "thread:one");
    assert.equal(calls[1].args.resume, false);
    assert.equal(calls[1].args.ephemeral, true);
    assert.equal(calls[1].args.model, "test-model");
    assert.equal(calls[1].args.effort, "low");
  } finally {
    await executor.close();
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(closed, true);
});

test("LocalCodexHostExecutor rejects invalid provider responses", async () => {
  const executor = new LocalCodexHostExecutor({
    codexClient: {
      async createWorldHostThread() {
        return {};
      },
      async runWorldHostTurn() {
        return {};
      },
    },
  });
  await assert.rejects(
    () => executor.prepareTurn({ worldId: "world:bad", worldName: "坏响应世界" }),
    /did not return a thread id/u,
  );
  await assert.rejects(
    () => executor.executeTurn({ context: null, prompt: "prompt" }),
    /prepared Host execution context is required/u,
  );
  await assert.rejects(
    () => executor.executeTurn({ context: { id: "thread:bad" }, prompt: "prompt" }),
    /returned an invalid turn result/u,
  );
});
