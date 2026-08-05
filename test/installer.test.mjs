import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import {
  DEFAULT_AGENT_WORLD_SERVER_URL,
  installPetSocial,
  normalizeServerUrl
} from "../src/installer.mjs";
import { PetSocialStore } from "../src/store.mjs";

test("server URLs require HTTPS except for loopback development", () => {
  assert.equal(DEFAULT_AGENT_WORLD_SERVER_URL, "https://kobemacbook-pro.tail645a7b.ts.net");
  assert.equal(normalizeServerUrl("https://pets.example.test/"), "https://pets.example.test");
  assert.equal(normalizeServerUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
  assert.equal(normalizeServerUrl("http://localhost:8787"), "http://localhost:8787");
  assert.throws(
    () => normalizeServerUrl("http://pets.example.test"),
    /HTTPS/
  );
});

test("a clean isolated install registers, stores credentials securely, and installs the skill", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store, inviteRequired: true });
  const address = await app.listen();
  const invite = store.createInvite({ label: "installer-test" });
  const sandbox = mkdtempSync(resolve(tmpdir(), "codex-pet-install-"));
  const prefix = resolve(sandbox, "runtime");
  const codexHome = resolve(sandbox, "codex-home");
  const launchAgentsDir = resolve(sandbox, "LaunchAgents");
  const commands = [];
  try {
    const result = await installPetSocial({
      projectRoot: resolve(import.meta.dirname, ".."),
      prefix,
      codexHome,
      serverUrl: address.url,
      recoveryEmail: "installer@example.test",
      displayName: "Installer Pet",
      characterForm: "robot",
      inviteCode: invite.code,
      launchAgentsDir,
      platform: "darwin"
    }, {
      execFileSync(command, args) {
        commands.push([command, args]);
      }
    });

    assert.equal(result.reused, false);
    assert.equal(result.serverUrl, address.url);
    assert.equal(result.referralInvite.maxUses, 1);
    assert.equal(result.referralInvite.registrationOrdinal, 1);
    const config = JSON.parse(readFileSync(resolve(prefix, "config.json"), "utf8"));
    assert.equal(config.serverUrl, address.url);
    assert.equal(typeof config.token, "string");
    assert.equal(config.characterId, result.characterId);
    assert.equal(config.agentBindingId, result.agentBindingId);
    assert.equal(config.agentProvider, "codex");
    assert.equal((await new PetSocialClient(config).character()).character.form, "robot");
    assert.equal(statSync(resolve(prefix, "config.json")).mode & 0o777, 0o600);
    assert.match(
      readFileSync(resolve(codexHome, "skills/diyworld/SKILL.md"), "utf8"),
      /name: diyworld/
    );
    assert.equal(existsSync(result.plistPath), true);
    assert.ok(
      commands.some(([command, args]) =>
        command === "launchctl" && args[0] === "bootstrap"
      )
    );
    assert.ok(
      commands.some(([command, args]) =>
        command === "codex" &&
        args.join(" ") === `mcp add diyworld -- npx -y @diyworld/mcp@latest mcp --config ${resolve(prefix, "config.json")}`
      )
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("a recovery install restores the same pet and consumes the code", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  const original = await PetSocialClient.register(address.url, {
    recoveryEmail: "installer-recovery@example.test",
    displayName: "Recoverable Pet"
  });
  const recovery = store.createAccountRecovery({
    recoveryEmail: "installer-recovery@example.test",
    expiresAt: Date.now() + 15 * 60 * 1000
  });
  const sandbox = mkdtempSync(resolve(tmpdir(), "codex-pet-recovery-install-"));
  try {
    const result = await installPetSocial({
      projectRoot: resolve(import.meta.dirname, ".."),
      prefix: resolve(sandbox, "runtime"),
      codexHome: resolve(sandbox, "codex-home"),
      serverUrl: address.url,
      recoveryEmail: "installer-recovery@example.test",
      recoveryCode: recovery.recoveryCode,
      installLaunchAgent: false,
      registerMcp: false,
      platform: "darwin"
    });
    assert.equal(result.recovered, true);
    assert.equal(result.petId, original.pet.id);
    const config = JSON.parse(
      readFileSync(resolve(sandbox, "runtime/config.json"), "utf8")
    );
    assert.equal((await new PetSocialClient(config).me()).pet.id, original.pet.id);
    await assert.rejects(
      () => PetSocialClient.recover(address.url, {
        recoveryEmail: "installer-recovery@example.test",
        recoveryCode: recovery.recoveryCode
      }),
      (error) => error.code === "INVALID_RECOVERY_CODE"
    );
  } finally {
    await app.close();
    store.close();
  }
});

test("the installer moves an existing legacy configuration into the DIYworld directory", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  const sandbox = mkdtempSync(resolve(tmpdir(), "diyworld-migration-"));
  const legacyDirectory = resolve(sandbox, ".codex-pet-social");
  const legacyConfigPath = resolve(legacyDirectory, "config.json");
  try {
    const registration = await PetSocialClient.register(address.url, {
      recoveryEmail: "migration@example.test",
      displayName: "Migrated World"
    });
    mkdirSync(legacyDirectory, { recursive: true });
    writeFileSync(legacyConfigPath, JSON.stringify({
      serverUrl: address.url,
      token: registration.token
    }));

    const result = await installPetSocial({
      projectRoot: resolve(import.meta.dirname, ".."),
      userHome: sandbox,
      serverUrl: address.url,
      platform: "darwin",
      installLaunchAgent: false,
      registerMcp: false
    });

    assert.equal(result.migratedLegacyConfig, true);
    assert.equal(result.reused, true);
    assert.equal(result.configPath, resolve(sandbox, ".diyworld/config.json"));
    assert.equal(existsSync(legacyConfigPath), true);
    assert.equal(JSON.parse(readFileSync(result.configPath, "utf8")).token, registration.token);
  } finally {
    await app.close();
    store.close();
  }
});

test("reinstalling preserves a valid identity and rejects an accidental server switch", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  const sandbox = mkdtempSync(resolve(tmpdir(), "codex-pet-reinstall-"));
  const options = {
    projectRoot: resolve(import.meta.dirname, ".."),
    prefix: resolve(sandbox, "runtime"),
    codexHome: resolve(sandbox, "codex-home"),
    serverUrl: address.url,
    recoveryEmail: "reinstall@example.test",
    displayName: "Reinstall Pet",
    installLaunchAgent: false,
    registerMcp: false,
    platform: "darwin"
  };
  try {
    const first = await installPetSocial(options);
    const second = await installPetSocial(options);
    assert.equal(second.reused, true);
    assert.equal(second.petId, first.petId);

    await assert.rejects(
      () => installPetSocial({ ...options, serverUrl: "https://other.example.test" }),
      /already points to/
    );
  } finally {
    await app.close();
    store.close();
  }
});
