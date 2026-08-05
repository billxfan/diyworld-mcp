import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export function defaultConfigPath() {
  const configured = process.env.DIYWORLD_CONFIG ??
    process.env.AGENT_WORLD_CONFIG ??
    process.env.PET_SOCIAL_CONFIG;
  if (configured) return resolve(configured);

  const modernPath = resolve(homedir(), ".diyworld/config.json");
  if (existsSync(modernPath)) return modernPath;
  return resolve(homedir(), ".codex-pet-social/config.json");
}

export function readConfig(path = defaultConfigPath()) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Agent World Social is not configured. Connect an Agent first. Expected: ${path}`);
    }
    throw error;
  }
}

export function writeConfig(config, path = defaultConfigPath()) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  chmodSync(path, 0o600);
  return path;
}

export function updateConfig(updater, path = defaultConfigPath()) {
  const current = readConfig(path);
  const next = updater(structuredClone(current));
  writeConfig(next, path);
  return next;
}
