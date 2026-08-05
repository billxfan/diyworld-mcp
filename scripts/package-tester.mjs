#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(projectRoot, "dist");
const npmCacheDir = resolve(projectRoot, ".npm-cache");
mkdirSync(outputDir, { recursive: true });
mkdirSync(npmCacheDir, { recursive: true });
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npmCommand, ["pack", "--ignore-scripts", "--pack-destination", outputDir], {
  cwd: projectRoot,
  env: { ...process.env, npm_config_cache: npmCacheDir },
  stdio: "inherit"
});
console.log(`Tester package created in ${outputDir}`);
