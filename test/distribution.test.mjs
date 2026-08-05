import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const mcpServer = readFileSync(resolve(root, "src/mcp-server.mjs"), "utf8");
const cli = readFileSync(resolve(root, "src/cli.mjs"), "utf8");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const connector = readFileSync(resolve(root, "scripts/connect-agent.mjs"), "utf8");

test("the public MCP package contains every runtime and onboarding surface", () => {
  assert.deepEqual(packageJson.files, [
    "src/",
    "scripts/",
    "skills/",
    "test-console/",
    "README.md",
    "TESTING.zh-CN.md"
  ]);
  assert.equal(packageJson.scripts.doctor, "node scripts/doctor.mjs");
  assert.equal(packageJson.scripts["connect:agent"], "node scripts/connect-agent.mjs");
  assert.equal(packageJson.scripts["release:check"], "node scripts/release-check.mjs");
  assert.equal(
    packageJson.scripts["docs:official-worlds"],
    "node scripts/generate-official-world-doc.mjs",
  );
  assert.equal(packageJson.scripts["pack:tester"], "node scripts/package-tester.mjs");
  assert.equal(packageJson.bin["agent-world"], "scripts/agent-world-social.mjs");
  assert.equal(packageJson.bin.diyworld, "scripts/agent-world-social.mjs");
  assert.match(cli, /DIYworld CLI/);
  assert.match(cli, /binding-revoke BINDING_ID --confirm/);
});

test("the package, MCP server, and onboarding instructions agree on the connection contract", () => {
  assert.match(mcpServer, new RegExp(`version: ["']${packageJson.version.replaceAll(".", "\\.")}["']`));
  assert.match(readme, /npx @diyworld\/mcp@latest connect --json/);
  assert.match(readme, /remote_mcp_config/);
  assert.match(readme, /profile_get/);
  assert.match(connector, /status: "needs_input"/);
  assert.match(connector, /mcp_config/);
});
