import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { connectAgent, onboardingRequirements } from "../src/agent-connector.mjs";
import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { CLIENT_PACKAGE_VERSION } from "../src/release.mjs";
import { PetSocialStore } from "../src/store.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

function runConnector(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["scripts/connect-agent.mjs", ...args], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code, stdout, stderr }));
  });
}

test("the generic connector creates a profile and returns portable MCP config", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  const directory = mkdtempSync(resolve(tmpdir(), "agent-world-connect-"));
  const configPath = resolve(directory, "identity.json");
  try {
    const result = await connectAgent({
      projectRoot,
      serverUrl: address.url,
      configPath,
      recoveryEmail: "connector@example.test",
      displayName: "Cloud Cartographer",
      provider: "custom",
      clientName: "Research Agent",
      clientInstanceId: "research-agent-1"
    });

    assert.equal(result.reused, false);
    assert.equal(result.profile.name, "Cloud Cartographer");
    assert.equal(result.agentProvider, "custom");
    assert.equal(result.mcp.command, "npx");
    assert.deepEqual(
      result.mcp.args,
      ["-y", `@diyworld/mcp@${CLIENT_PACKAGE_VERSION}`, "mcp", "--config", configPath]
    );
    assert.equal(result.remoteMcp.type, "http");
    assert.equal(result.remoteMcp.url, `${address.url}/mcp`);
    assert.match(result.remoteMcp.headers.Authorization, /^Bearer /);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);

    const stored = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(stored.characterId, result.profileId);
    assert.equal(stored.profileId, result.profileId);
    assert.equal(stored.agentBindingId, result.agentBindingId);
    assert.equal(stored.agentProvider, "custom");
    assert.equal(stored.clientVersion, CLIENT_PACKAGE_VERSION);
    assert.equal(stored.protocolVersion, "1");
    assert.equal(typeof stored.token, "string");

    const client = new PetSocialClient(stored);
    const identity = await client.me();
    assert.equal(identity.character.id, result.profileId);
    assert.equal(identity.profile.id, result.profileId);
    assert.equal(identity.agentBinding.provider, "custom");

    const reused = await connectAgent({
      projectRoot,
      serverUrl: address.url,
      configPath,
      provider: "custom",
      clientName: "Research Agent",
      clientInstanceId: "research-agent-1"
    });
    assert.equal(reused.reused, true);
    assert.equal(reused.profileId, result.profileId);
    assert.equal(reused.agentProvider, "custom");
    assert.equal(reused.clientVersion, CLIENT_PACKAGE_VERSION);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the generic connector describes only the details an Agent must collect", async () => {
  const store = new PetSocialStore(":memory:", { inviteRequired: true });
  const app = createPetSocialApp({ store, inviteRequired: true });
  const address = await app.listen();
  try {
    const onboarding = await onboardingRequirements({ serverUrl: address.url });
    assert.deepEqual(
      onboarding.fields.map(({ name, required }) => ({ name, required })),
      [
        { name: "email", required: true },
        { name: "name", required: true },
        { name: "invite", required: true }
      ]
    );
    assert.equal(
      onboarding.nextCommand({ provider: "other" }),
      'npx @diyworld/mcp@latest connect --json --email <EMAIL> --name "<WORLD_NICKNAME>" --invite <INVITE_CODE> --provider other'
    );
    assert.equal(
      onboarding.nextCommand({ provider: "claude", recoveryCode: "recover_123" }),
      "npx @diyworld/mcp@latest connect --json --email <EMAIL> --recovery recover_123 --invite <INVITE_CODE> --provider claude"
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("the non-interactive connector returns structured follow-up questions", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store, inviteRequired: true });
  const address = await app.listen();
  try {
    const run = await runConnector(["--server", address.url, "--json"]);
    assert.equal(run.code, 2);
    assert.equal(run.stderr, "");
    const output = JSON.parse(run.stdout);
    assert.equal(output.status, "needs_input");
    assert.deepEqual(output.fields.map((field) => field.name), ["email", "name", "invite"]);
    assert.match(output.next_command, /--invite <INVITE_CODE>/);
  } finally {
    await app.close();
    store.close();
  }
});

test("account recovery binds the same profile to a different Agent provider", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  const directory = mkdtempSync(resolve(tmpdir(), "agent-world-recover-"));
  try {
    const original = await PetSocialClient.register(address.url, {
      recoveryEmail: "connector-recovery@example.test",
      displayName: "Persistent Character",
      agentProvider: "codex"
    });
    const recovery = store.createAccountRecovery({
      recoveryEmail: "connector-recovery@example.test",
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    const recovered = await connectAgent({
      projectRoot,
      serverUrl: address.url,
      configPath: resolve(directory, "claude.json"),
      recoveryEmail: "connector-recovery@example.test",
      recoveryCode: recovery.recoveryCode,
      provider: "claude",
      clientName: "Claude Agent",
      clientInstanceId: "claude-agent-1"
    });

    assert.equal(recovered.recovered, true);
    assert.equal(recovered.profileId, original.profile.id);
    assert.equal(recovered.profile.name, "Persistent Character");
    assert.equal(recovered.agentProvider, "claude");
    assert.notEqual(recovered.agentBindingId, original.agentBinding.id);

    const originalClient = new PetSocialClient({
      serverUrl: address.url,
      token: original.token
    });
    const bindings = await originalClient.agentBindings();
    assert.equal(bindings.agentBindings.length, 2);
    assert.deepEqual(
      bindings.agentBindings.map((binding) => binding.provider).sort(),
      ["claude", "codex"]
    );
    await assert.rejects(
      () => originalClient.revokeAgentBinding(recovered.agentBindingId),
      (error) => error.code === "AGENT_BINDING_REVOCATION_NOT_CONFIRMED"
    );
    const revoked = await originalClient.revokeAgentBinding(
      recovered.agentBindingId,
      { confirmed: true }
    );
    assert.equal(revoked.agentBinding.status, "revoked");
    const recoveredConfig = JSON.parse(
      readFileSync(resolve(directory, "claude.json"), "utf8")
    );
    await assert.rejects(
      () => new PetSocialClient(recoveredConfig).character(),
      (error) => error.code === "UNAUTHORIZED"
    );
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
