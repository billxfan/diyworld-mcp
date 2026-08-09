#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const [command = "install", ...args] = process.argv.slice(2);
const scripts = {
  install: "install.mjs",
  connect: "connect-agent.mjs",
  upgrade: "upgrade.mjs",
  mcp: "mcp.mjs"
};

if (command === "help" || command === "--help" || command === "-h") {
  console.log(`Agent World Social

Usage:
  agent-world install [--invite CODE]
  agent-world connect [--json] [--provider PROVIDER] [--invite CODE]
  agent-world upgrade [--config PATH] [--json]
  diyworld mcp [--config PATH] [--profile standard|advanced]

install: Set up Codex Desktop on macOS.
connect: Create a portable MCP configuration for Claude, Cursor, WorkBuddy, or another MCP client. With --json, missing details are returned as structured questions.
upgrade: Prepare an explicit exact-version MCP replacement without changing identity or credentials.
mcp: Start the standard stdio MCP server. It exposes task-oriented tools by default; advanced protocol tools require --profile advanced.`);
  process.exit(0);
}

const script = scripts[command];
if (!script) {
  console.error(`Unknown command: ${command}. Run agent-world help for usage.`);
  process.exit(1);
}

const child = spawn(process.execPath, [resolve(scriptsDir, script), ...args], {
  stdio: "inherit"
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
