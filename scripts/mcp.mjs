#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  strict: true,
  options: {
    config: { type: "string" },
    profile: { type: "string" },
    help: { type: "boolean", short: "h", default: false }
  }
});

if (values.help) {
  console.error("Usage: diyworld mcp [--config PATH] [--profile standard|advanced]");
  process.exit(0);
}

if (values.config) process.env.DIYWORLD_CONFIG = resolve(values.config);
if (values.profile) process.env.DIYWORLD_MCP_PROFILE = values.profile;
await import("../src/mcp-server.mjs");
