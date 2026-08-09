import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { readConfig } from "./config.mjs";
import { checkPetSocialHealth } from "./installer.mjs";
import {
  CLIENT_PACKAGE_VERSION,
  clientReleaseMetadata,
  clientUpdateStatus,
  pinnedMcpConfig,
} from "./release.mjs";

function accountConfigPaths(accountsRoot) {
  if (!existsSync(accountsRoot)) return [];
  const paths = [];
  for (const account of readdirSync(accountsRoot, { withFileTypes: true })) {
    if (!account.isDirectory()) continue;
    const accountPath = resolve(accountsRoot, account.name);
    for (const client of readdirSync(accountPath, { withFileTypes: true })) {
      if (client.isFile() && client.name.endsWith(".json")) {
        paths.push(resolve(accountPath, client.name));
      }
    }
  }
  return paths.sort();
}

export function resolveUpgradeConfigPath(options = {}) {
  if (options.configPath) return resolve(options.configPath);
  const configured =
    options.env?.DIYWORLD_CONFIG ??
    options.env?.AGENT_WORLD_CONFIG ??
    options.env?.PET_SOCIAL_CONFIG;
  if (configured) return resolve(configured);

  const root = resolve(options.homeDir ?? homedir(), ".diyworld");
  const primary = resolve(root, "config.json");
  if (existsSync(primary)) return primary;

  const candidates = accountConfigPaths(resolve(root, "accounts"));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(
      `Multiple DIYworld Agent configurations were found. Re-run with --config PATH and choose one of: ${candidates.join(", ")}`,
    );
  }
  throw new Error(
    "DIYworld is not configured. Connect an Agent first, or pass --config PATH.",
  );
}

export async function prepareClientUpgrade(options = {}, dependencies = {}) {
  const configPath = resolveUpgradeConfigPath({
    configPath: options.configPath,
    homeDir: options.homeDir,
    env: options.env ?? process.env,
  });
  const config = readConfig(configPath);
  const health = await checkPetSocialHealth(
    config.serverUrl,
    dependencies.fetch ?? globalThis.fetch,
  );
  const release = health.versions ?? clientReleaseMetadata();
  const targetVersion = CLIENT_PACKAGE_VERSION;
  if (clientUpdateStatus(targetVersion, release) === "required") {
    throw new Error(
      `This package is older than the server minimum ${release.minimum_supported_client_version}. Run the upgrade command with @latest.`,
    );
  }
  const mcp = pinnedMcpConfig(configPath, targetVersion);
  return {
    status: "upgrade_ready",
    current_client_version: config.clientVersion ?? "unknown",
    target_client_version: targetVersion,
    update_status:
      config.clientVersion && /^\d+\.\d+\.\d+/.test(config.clientVersion)
        ? clientUpdateStatus(config.clientVersion, release)
        : "unknown",
    protocol_version: release.protocol_version,
    minimum_supported_client_version:
      release.minimum_supported_client_version,
    recommended_client_version: release.recommended_client_version,
    config_path: configPath,
    mcp_config: { mcpServers: { diyworld: mcp } },
    codex: {
      remove_args: ["mcp", "remove", "diyworld"],
      add_args: ["mcp", "add", "diyworld", "--", mcp.command, ...mcp.args],
    },
    note:
      "Apply the replacement MCP configuration explicitly, then restart the MCP client. Character identity, credential, history, and World state remain unchanged.",
  };
}
