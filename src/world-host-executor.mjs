import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { CodexAppServerClient } from "./codex-app-server.mjs";

export class HostExecutor {
  constructor({ id, contextIsolation = "per_turn" } = {}) {
    if (typeof id !== "string" || id.trim() === "" || id.length > 128) {
      throw new Error("A HostExecutor id is required");
    }
    if (contextIsolation !== "per_turn") {
      throw new Error("HostExecutor contextIsolation must be per_turn");
    }
    this.id = id;
    this.contextIsolation = contextIsolation;
  }

  bindingMetadata() {
    return {
      executor_type: this.id,
      context_isolation: "one_fresh_execution_context_per_turn",
    };
  }

  // Implementations receive an AbortSignal and must stop outstanding external
  // work after it is aborted. A prepared context is valid for one turn only.
  async prepareTurn() {
    throw new Error(`${this.id} does not implement prepareTurn`);
  }

  async executeTurn() {
    throw new Error(`${this.id} does not implement executeTurn`);
  }

  // close({ signal }) may run concurrently with prepareTurn/executeTurn and
  // must actively release or cancel their underlying resources.
  async close() {}
}

export function assertHostExecutor(executor) {
  if (!executor || typeof executor !== "object") {
    throw new Error("A HostExecutor is required");
  }
  if (
    typeof executor.id !== "string" ||
    executor.id.trim() === "" ||
    executor.id.length > 128
  ) {
    throw new Error("HostExecutor.id must be a non-empty string");
  }
  if (executor.contextIsolation !== "per_turn") {
    throw new Error("HostExecutor contextIsolation must be per_turn");
  }
  for (const method of ["bindingMetadata", "prepareTurn", "executeTurn", "close"]) {
    if (typeof executor[method] !== "function") {
      throw new Error(`HostExecutor.${method} must be a function`);
    }
  }
  return executor;
}

export class LocalCodexHostExecutor extends HostExecutor {
  constructor({
    codexClient = new CodexAppServerClient(),
    hostRoot = resolve(process.cwd(), "data/world-hosts"),
    model,
    effort = "medium",
    contextIsolation = "per_turn",
  } = {}) {
    super({ id: "local_codex", contextIsolation });
    this.codexClient = codexClient;
    this.hostRoot = hostRoot;
    this.model = model;
    this.effort = effort;
  }

  bindingMetadata() {
    return {
      executor_type: this.id,
      // Preserve the existing operator-facing value for the default executor.
      context_isolation: "one_fresh_thread_per_turn",
    };
  }

  async prepareTurn({ worldId, worldName, signal }) {
    signal?.throwIfAborted();
    const cwd = resolve(this.hostRoot, encodeURIComponent(worldId));
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const thread = await this.codexClient.createWorldHostThread({
      worldId,
      worldName,
      cwd,
      model: this.model,
      ephemeral: true,
    });
    signal?.throwIfAborted();
    if (!thread?.id) {
      throw new Error("Local Codex Host executor did not return a thread id");
    }
    return {
      id: thread.id,
      worldId,
      raw: thread,
    };
  }

  async executeTurn({ context, prompt, signal }) {
    signal?.throwIfAborted();
    if (!context?.id) throw new Error("A prepared Host execution context is required");
    const turn = await this.codexClient.runWorldHostTurn({
      threadId: context.id,
      prompt,
      model: this.model,
      effort: this.effort,
      resume: false,
      ephemeral: true,
    });
    signal?.throwIfAborted();
    if (!turn?.turnId || typeof turn.text !== "string") {
      throw new Error("Local Codex Host executor returned an invalid turn result");
    }
    return {
      id: turn.turnId,
      text: turn.text,
      raw: turn,
    };
  }

  async close() {
    await this.codexClient.close?.();
  }
}
