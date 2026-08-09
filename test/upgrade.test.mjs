import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { writeConfig } from "../src/config.mjs";
import { CLIENT_PACKAGE_VERSION } from "../src/release.mjs";
import {
  prepareClientUpgrade,
  resolveUpgradeConfigPath,
} from "../src/upgrade.mjs";

test("explicit upgrade prepares an exact replacement without changing identity", async () => {
  const app = createPetSocialApp({
    clientRelease: {
      minimumSupportedClientVersion: "0.9.2",
      recommendedClientVersion: CLIENT_PACKAGE_VERSION,
      platformRelease: "2026-08-09",
    },
  });
  const address = await app.listen();
  const directory = mkdtempSync(resolve(tmpdir(), "diyworld-upgrade-"));
  const configPath = resolve(directory, "identity.json");
  try {
    const registration = await PetSocialClient.register(address.url, {
      recoveryEmail: "upgrade@example.test",
      displayName: "Upgrade Keeper",
      agentProvider: "codex",
    });
    writeConfig({
      serverUrl: address.url,
      token: registration.token,
      ownerId: registration.owner.id,
      deviceId: registration.device.id,
      characterId: registration.character.id,
      clientVersion: "0.9.2",
    }, configPath);
    const before = readFileSync(configPath, "utf8");

    const result = await prepareClientUpgrade({ configPath });

    assert.equal(result.status, "upgrade_ready");
    assert.equal(result.current_client_version, "0.9.2");
    assert.equal(result.target_client_version, CLIENT_PACKAGE_VERSION);
    assert.equal(result.update_status, "optional");
    assert.equal(
      result.mcp_config.mcpServers.diyworld.args[1],
      `@diyworld/mcp@${CLIENT_PACKAGE_VERSION}`,
    );
    assert.equal(result.codex.add_args[4], "npx");
    assert.equal(readFileSync(configPath, "utf8"), before);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("upgrade refuses a package older than the server minimum", async () => {
  const app = createPetSocialApp({
    clientRelease: {
      minimumSupportedClientVersion: "9.0.0",
      recommendedClientVersion: "9.0.0",
    },
  });
  const address = await app.listen();
  const directory = mkdtempSync(resolve(tmpdir(), "diyworld-upgrade-old-"));
  const configPath = resolve(directory, "identity.json");
  try {
    writeConfig({ serverUrl: address.url, token: "unused" }, configPath);
    await assert.rejects(
      prepareClientUpgrade({ configPath }),
      /no longer supported|older than the server minimum/,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("upgrade discovers one isolated Agent config and refuses ambiguity", () => {
  const root = mkdtempSync(resolve(tmpdir(), "diyworld-upgrade-discovery-"));
  try {
    const first = resolve(root, ".diyworld/accounts/account-a/codex.json");
    writeConfig({ serverUrl: "https://api.diyworld.ai" }, first);
    assert.equal(resolveUpgradeConfigPath({ homeDir: root, env: {} }), first);

    const second = resolve(root, ".diyworld/accounts/account-b/claude.json");
    writeConfig({ serverUrl: "https://api.diyworld.ai" }, second);
    assert.throws(
      () => resolveUpgradeConfigPath({ homeDir: root, env: {} }),
      /Multiple DIYworld Agent configurations/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
