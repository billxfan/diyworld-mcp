#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultConfigPath, readConfig } from "../src/config.mjs";
import { assertSupportedRuntime, checkPetSocialHealth, normalizeServerUrl } from "../src/installer.mjs";

const { values } = parseArgs({
  strict: true,
  options: {
    config: { type: "string" },
    server: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  }
});

if (values.help) {
  console.log("Usage: npm run doctor -- [--config PATH] [--server URL] [--json]");
  process.exit(0);
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

try {
  assertSupportedRuntime();
  record("runtime", true, `macOS / Node ${process.versions.node}`);
} catch (error) {
  record("runtime", false, error.message);
}

try {
  const version = execFileSync("codex", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  record("codex", true, version || "Codex CLI available");
} catch {
  record("codex", false, "Codex CLI is not available on PATH.");
}

let config;
const configPath = resolve(values.config ?? defaultConfigPath());
try {
  config = readConfig(configPath);
  const mode = statSync(configPath).mode & 0o777;
  record("config", mode === 0o600, mode === 0o600 ? configPath : `${configPath} has insecure mode ${mode.toString(8)}`);
} catch (error) {
  record("config", false, error.message);
}

try {
  const serverUrl = normalizeServerUrl(values.server ?? config?.serverUrl);
  const health = await checkPetSocialHealth(serverUrl);
  record("server", true, `${serverUrl} (${health.registrationMode})`);
} catch (error) {
  record("server", false, error.message);
}

const skillPath = resolve(homedir(), ".codex/skills/diyworld/SKILL.md");
record("skill", existsSync(skillPath), existsSync(skillPath) ? skillPath : "DIYworld skill is not installed.");

const bridgePath = resolve(homedir(), "Library/LaunchAgents/com.diyworld.bridge.plist");
record("bridge", existsSync(bridgePath), existsSync(bridgePath) ? bridgePath : "DIYworld silent-delivery bridge is not installed.");

if (values.json) {
  console.log(JSON.stringify({ ok: checks.every((check) => check.ok), checks }, null, 2));
} else {
  for (const check of checks) console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
}
if (checks.some((check) => !check.ok)) process.exitCode = 1;
