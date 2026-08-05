import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { PetSocialClient } from "./client.mjs";
import { writeConfig } from "./config.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
// The beta service is intentionally the default so new users do not need to
// know any infrastructure details. --server remains available for local
// development, staging, and a future endpoint migration.
export const DEFAULT_AGENT_WORLD_SERVER_URL =
  "https://kobemacbook-pro.tail645a7b.ts.net";

export function normalizeServerUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("A valid Agent World Social server URL is required.");
  }
  if (url.username || url.password) {
    throw new Error("The server URL must not contain credentials.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error("The Agent World Social server must use HTTPS; HTTP is allowed only for loopback development.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The server URL must be an origin without a path, query, or fragment.");
  }
  return url.origin;
}

export function assertSupportedRuntime({
  platform = process.platform,
  nodeVersion = process.versions.node
} = {}) {
  if (platform !== "darwin") {
    throw new Error("Agent World Social's Codex delivery bridge currently supports macOS only.");
  }
  const major = Number.parseInt(String(nodeVersion).split(".")[0], 10);
  if (!Number.isFinite(major) || major < 24) {
    throw new Error(`Node.js 24 or newer is required; found ${nodeVersion}.`);
  }
}

export async function checkPetSocialHealth(serverUrl, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(`${serverUrl}/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    throw new Error(`Cannot reach the Agent World Social server at ${serverUrl}: ${error.message}`);
  }
  const body = await response.json().catch(() => ({}));
  if (
    !response.ok ||
    (body.service !== "diyworld" && body.service !== "codex-pet-social" && body.product !== "agent-world-social") ||
    body.ok !== true
  ) {
    throw new Error(`The server at ${serverUrl} is not a healthy Agent World Social service.`);
  }
  return body;
}

function copyRuntime(projectRoot, prefix, codexHome) {
  mkdirSync(prefix, { recursive: true, mode: 0o700 });
  mkdirSync(resolve(prefix, "logs"), { recursive: true, mode: 0o700 });
  for (const entry of ["src", "scripts", "test-console"]) {
    const source = resolve(projectRoot, entry);
    const target = resolve(prefix, entry);
    if (source !== target) cpSync(source, target, { recursive: true, force: true });
  }
  for (const entry of ["package.json", "README.md", "TESTING.zh-CN.md"]) {
    const source = resolve(projectRoot, entry);
    const target = resolve(prefix, entry);
    if (source !== target && existsSync(source)) copyFileSync(source, target);
  }
  const skillDir = resolve(codexHome, "skills/diyworld");
  mkdirSync(skillDir, { recursive: true });
  copyFileSync(
    resolve(projectRoot, "skills/diyworld/SKILL.md"),
    resolve(skillDir, "SKILL.md")
  );
}

function deliveryDefaults() {
  return {
    enabled: false,
    threadId: null,
    lastDeliveredEventSequence: 0,
    fallbackNotifiedSequence: 0
  };
}

function registrationConfig(serverUrl, registration) {
  return {
    serverUrl,
    token: registration.token,
    ownerId: registration.owner.id,
    deviceId: registration.device.id,
    petId: registration.pet.id,
    characterId: registration.character?.id ?? registration.pet.id,
    agentBindingId: registration.agentBinding?.id ?? null,
    agentProvider: registration.agentBinding?.provider ?? "codex",
    eventCursor: 0,
    codexDelivery: deliveryDefaults()
  };
}

function launchAgentPlist({ nodePath, bridgePath, configPath, stdoutPath, stderrPath }) {
  const xmlEscape = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.diyworld.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(bridgePath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>DIYWORLD_CONFIG</key><string>${xmlEscape(configPath)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

export async function installPetSocial(options = {}, dependencies = {}) {
  assertSupportedRuntime({
    platform: options.platform,
    nodeVersion: options.nodeVersion
  });
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolve(options.projectRoot);
  const defaultPrefix = resolve(userHome, ".diyworld");
  const prefix = resolve(options.prefix ?? defaultPrefix);
  const codexHome = resolve(options.codexHome ?? resolve(userHome, ".codex"));
  const launchAgentsDir = resolve(
    options.launchAgentsDir ?? resolve(userHome, "Library/LaunchAgents")
  );
  const configPath = resolve(prefix, "config.json");
  const legacyConfigPath = resolve(userHome, ".codex-pet-social/config.json");
  const migratedLegacyConfig =
    !options.prefix &&
    !existsSync(configPath) &&
    existsSync(legacyConfigPath);
  if (migratedLegacyConfig) {
    mkdirSync(prefix, { recursive: true, mode: 0o700 });
    copyFileSync(legacyConfigPath, configPath);
    chmodSync(configPath, 0o600);
  }
  const existing = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : null;
  const serverUrl = normalizeServerUrl(
    options.serverUrl ?? existing?.serverUrl ?? DEFAULT_AGENT_WORLD_SERVER_URL
  );
  if (
    existing &&
    !options.recoveryCode &&
    normalizeServerUrl(existing.serverUrl) !== serverUrl
  ) {
    throw new Error(
      `This installation already points to ${existing.serverUrl}. Use an account recovery code to move or replace it safely.`
    );
  }
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  await checkPetSocialHealth(serverUrl, fetchImpl);
  copyRuntime(projectRoot, prefix, codexHome);

  let registration;
  let reused = false;
  if (options.recoveryCode) {
    if (!options.recoveryEmail) throw new Error("Account recovery requires an email address.");
    registration = await PetSocialClient.recover(serverUrl, {
      recoveryEmail: options.recoveryEmail,
      recoveryCode: options.recoveryCode,
      deviceName: options.deviceName ?? "Recovered Mac",
      agentProvider: options.agentProvider ?? "codex",
      clientInstanceId: options.clientInstanceId
    });
    if (existing) copyFileSync(configPath, `${configPath}.pre-recovery-backup`);
  } else if (existing) {
    const identity = await new PetSocialClient(existing).me();
    registration = {
      token: existing.token,
      owner: { id: identity.ownerId },
      device: { id: identity.deviceId },
      pet: identity.pet
    };
    reused = true;
  } else {
    if (!options.recoveryEmail || !options.displayName) {
      throw new Error("A recovery email and character name are required for first-time installation.");
    }
    registration = await PetSocialClient.register(serverUrl, {
      recoveryEmail: options.recoveryEmail,
      displayName: options.displayName,
      bio: options.bio ?? "",
      visibility: options.visibility ?? "public",
      deviceName: options.deviceName ?? "Mac",
      characterForm: options.characterForm ?? "custom",
      appearance: options.appearance ?? {},
      agentProvider: options.agentProvider ?? "codex",
      clientInstanceId: options.clientInstanceId,
      inviteCode: options.inviteCode
    });
  }

  if (!reused || options.recoveryCode) {
    writeConfig(registrationConfig(serverUrl, registration), configPath);
  }

  const exec = dependencies.execFileSync ?? execFileSync;
  const warnings = [];
  let plistPath = null;
  if (options.installLaunchAgent !== false) {
    mkdirSync(launchAgentsDir, { recursive: true });
    const legacyPlistPath = resolve(launchAgentsDir, "com.codexpetsocial.bridge.plist");
    plistPath = resolve(launchAgentsDir, "com.diyworld.bridge.plist");
    writeFileSync(plistPath, launchAgentPlist({
      nodePath: process.execPath,
      bridgePath: resolve(prefix, "src/bridge.mjs"),
      configPath,
      stdoutPath: resolve(prefix, "logs/bridge.log"),
      stderrPath: resolve(prefix, "logs/bridge.error.log")
    }), "utf8");
    const domain = `gui/${process.getuid()}`;
    try {
      exec("launchctl", ["bootout", domain, legacyPlistPath], { stdio: "ignore" });
    } catch {}
    try {
      exec("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
    } catch {}
    exec("launchctl", ["bootstrap", domain, plistPath], { stdio: "inherit" });
  }

  if (options.registerMcp !== false) {
    try {
      exec("codex", ["mcp", "remove", "codex-pet-social"], { stdio: "ignore" });
    } catch {}
    try {
      exec("codex", [
        "mcp", "remove", "diyworld"
      ], { stdio: "ignore" });
    } catch {}
    try {
      exec("codex", [
        "mcp", "add", "diyworld", "--", "npx", "-y",
        "@diyworld/mcp@latest", "mcp", "--config", configPath
      ], { stdio: "inherit" });
    } catch {
      warnings.push("Could not register the MCP server automatically. Run the command shown in README.md.");
    }
  }

  return {
    reused,
    recovered: Boolean(options.recoveryCode),
    serverUrl,
    ownerId: registration.owner.id,
    deviceId: registration.device.id,
    petId: registration.pet.id,
    characterId: registration.character?.id ?? registration.pet.id,
    agentBindingId: registration.agentBinding?.id ?? null,
    referralInvite: registration.referralInvite ?? null,
    configPath,
    skillPath: resolve(codexHome, "skills/diyworld/SKILL.md"),
    plistPath,
    warnings,
    migratedLegacyConfig
  };
}
