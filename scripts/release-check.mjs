#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PetSocialStore } from "../src/store.mjs";
import { rehearseAgentWorldMigration } from "../src/release-readiness.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  strict: true,
  options: {
    database: { type: "string" },
    "keep-copy": { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  }
});

if (values.help) {
  console.log(`Usage: npm run release:check -- [--database PATH] [--keep-copy PATH] [--json]

The source database is opened read-only. Migration runs twice on an SQLite online-backup copy.
If no database exists or is provided, a disposable legacy fixture is used.`);
  process.exit(0);
}

let fixtureDirectory;
function createLegacyFixture() {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "agent-world-legacy-fixture-"));
  const fixturePath = join(fixtureDirectory, "legacy.sqlite");
  const store = new PetSocialStore(fixturePath);
  store.register({
    recoveryEmail: "release-check@example.test",
    displayName: "Legacy Character"
  });
  store.db.exec("DROP TABLE agent_bindings; DROP TABLE characters;");
  store.close();
  return fixturePath;
}

const defaultDatabase = resolve(
  process.env.AGENT_WORLD_DB ??
    process.env.PET_SOCIAL_DB ??
    resolve(projectRoot, "data/pet-social.sqlite")
);
const sourceDatabase = values.database
  ? resolve(values.database)
  : existsSync(defaultDatabase)
    ? defaultDatabase
    : createLegacyFixture();
const keepCopy = values["keep-copy"] ? resolve(values["keep-copy"]) : undefined;
if (keepCopy) mkdirSync(dirname(keepCopy), { recursive: true });

try {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  const mcpSource = readFileSync(resolve(projectRoot, "src/mcp-server.mjs"), "utf8");
  const versionMatches = new RegExp(
    `version: ["']${packageJson.version.replaceAll(".", "\\.")}["']`
  ).test(mcpSource);
  const migration = await rehearseAgentWorldMigration(sourceDatabase, { copyPath: keepCopy });
  const result = {
    ok: versionMatches && migration.ok,
    version: packageJson.version,
    sourceKind: fixtureDirectory ? "synthetic_legacy_fixture" : "database_copy",
    checks: [
      {
        name: "version_contract",
        ok: versionMatches,
        detail: versionMatches
          ? "Package and MCP server versions match."
          : "Package and MCP server versions do not match."
      },
      ...migration.checks
    ],
    migration: {
      source: migration.source,
      rehearsalCopy: migration.rehearsalCopy,
      before: migration.before,
      after: migration.after
    }
  };

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent World Social release check v${result.version}`);
    for (const item of result.checks) {
      console.log(`${item.ok ? "✓" : "✗"} ${item.name}: ${item.detail}`);
    }
    console.log(`Source: ${result.sourceKind}`);
    if (result.migration.rehearsalCopy) {
      console.log(`Rehearsal copy retained at ${result.migration.rehearsalCopy}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Release check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
}
