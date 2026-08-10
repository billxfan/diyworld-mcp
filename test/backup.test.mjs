import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createVerifiedBackup } from "../scripts/backup.mjs";

test("operational backup creates a verified SQLite copy and refuses overwrite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "diyworld-backup-"));
  const database = join(directory, "world.sqlite");
  const outputDir = join(directory, "backups");
  const source = new DatabaseSync(database);
  source.exec("CREATE TABLE facts (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  source.prepare("INSERT INTO facts (value) VALUES (?)").run("preserved");
  source.close();
  const now = new Date("2026-08-10T14:00:00.000Z");
  try {
    const destination = await createVerifiedBackup({ database, outputDir, now });
    assert.ok(existsSync(destination));
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(
        copy.prepare("SELECT value FROM facts WHERE id = 1").get().value,
        "preserved",
      );
    } finally {
      copy.close();
    }
    await assert.rejects(
      createVerifiedBackup({ database, outputDir, now }),
      /Refusing to overwrite existing backup/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
