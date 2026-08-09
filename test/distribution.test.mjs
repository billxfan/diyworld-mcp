import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CLIENT_PACKAGE_VERSION } from "../src/release.mjs";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const cli = readFileSync(resolve(root, "src/cli.mjs"), "utf8");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const connector = readFileSync(resolve(root, "scripts/connect-agent.mjs"), "utf8");

test("the tester package contains every runtime and onboarding surface", () => {
  assert.deepEqual(packageJson.files, [
    "src/",
    "scripts/",
    "skills/",
    "docs/agent-world-release-runbook.md",
    "docs/official-worlds-v6.zh-CN.md",
    "docs/modules/agent-identity.md",
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
  assert.match(cli, /Agent World Social CLI/);
  assert.match(cli, /binding-revoke BINDING_ID --confirm/);
});

test("the package, MCP server, and onboarding instructions agree on the release version and install contract", () => {
  assert.equal(CLIENT_PACKAGE_VERSION, packageJson.version);
  assert.match(readme, /npx @diyworld\/mcp@latest install --invite INVITE_CODE/);
  assert.match(readme, /npm run doctor/);
  assert.match(readme, /TESTING\.zh-CN\.md/);
  assert.match(readme, /npx @diyworld\/mcp@latest connect --json/);
  assert.match(connector, /status: "needs_input"/);
  assert.match(connector, /mcp_config/);
  assert.match(
    readFileSync(resolve(root, "scripts/agent-world-social.mjs"), "utf8"),
    /upgrade/,
  );
});
