#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: projectRoot,
  stdio: "inherit",
});

console.log("Installed repository Git hooks from .githooks/.");
