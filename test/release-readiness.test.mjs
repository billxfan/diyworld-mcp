import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { rehearseAgentWorldMigration } from "../src/release-readiness.mjs";
import { PetSocialStore } from "../src/store.mjs";

test("release rehearsal migrates an online-backup copy and never changes the source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-release-test-"));
  const sourcePath = join(directory, "legacy.sqlite");
  const retainedCopy = join(directory, "rehearsal.sqlite");
  try {
    const legacy = new PetSocialStore(sourcePath);
    legacy.register({
      recoveryEmail: "release-legacy@example.test",
      displayName: "Legacy Pet"
    });
    legacy.db.exec("DROP TABLE agent_bindings; DROP TABLE characters;");
    legacy.close();

    const result = await rehearseAgentWorldMigration(sourcePath, {
      copyPath: retainedCopy
    });
    assert.equal(result.ok, true);
    assert.equal(result.before.identity.characters, 0);
    assert.equal(result.after.identity.characters, 1);
    assert.equal(result.after.identity.agentBindings, 1);
    assert.ok(result.checks.every((item) => item.ok));
    assert.equal(existsSync(retainedCopy), true);

    const untouchedSource = new DatabaseSync(sourcePath, { readOnly: true });
    const sourceTables = untouchedSource
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    assert.equal(sourceTables.includes("characters"), false);
    assert.equal(sourceTables.includes("agent_bindings"), false);
    untouchedSource.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release rehearsal refuses to overwrite its source or an existing copy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-release-guard-"));
  const sourcePath = join(directory, "source.sqlite");
  const existingPath = join(directory, "existing.sqlite");
  try {
    const store = new PetSocialStore(sourcePath);
    store.close();
    const existing = new PetSocialStore(existingPath);
    existing.close();

    await assert.rejects(
      rehearseAgentWorldMigration(sourcePath, { copyPath: sourcePath }),
      /must not be the source/
    );
    await assert.rejects(
      rehearseAgentWorldMigration(sourcePath, { copyPath: existingPath }),
      /Refusing to overwrite/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
