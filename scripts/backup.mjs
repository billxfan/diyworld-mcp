#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DatabaseSync, backup } from "node:sqlite";

function backupTimestamp(now) {
  return now.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/u, "Z");
}

export async function createVerifiedBackup({ database, outputDir, now = new Date() }) {
  if (!database) throw new Error("A source database path is required.");
  if (!outputDir) throw new Error("A backup output directory is required.");
  const sourcePath = resolve(database);
  const destinationDir = resolve(outputDir);
  mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
  const destinationPath = resolve(
    destinationDir,
    `${basename(sourcePath, ".sqlite")}-auto-${backupTimestamp(now)}.sqlite`,
  );
  if (existsSync(destinationPath)) {
    throw new Error(`Refusing to overwrite existing backup: ${destinationPath}`);
  }

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, destinationPath);
  } finally {
    source.close();
  }
  chmodSync(destinationPath, 0o600);

  const copy = new DatabaseSync(destinationPath, { readOnly: true });
  try {
    copy.exec("PRAGMA foreign_keys = ON");
    const integrity = copy.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error(`Backup integrity_check failed: ${JSON.stringify(integrity)}`);
    }
    const foreignKeys = copy.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length > 0) {
      throw new Error(`Backup has ${foreignKeys.length} foreign-key violation(s).`);
    }
  } finally {
    copy.close();
  }
  return destinationPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      database: { type: "string" },
      "output-dir": { type: "string" },
    },
  });
  const destination = await createVerifiedBackup({
    database:
      values.database ??
      process.env.AGENT_WORLD_DB ??
      process.env.PET_SOCIAL_DB,
    outputDir:
      values["output-dir"] ??
      process.env.AGENT_WORLD_BACKUP_DIR,
  });
  console.log(JSON.stringify({ ok: true, backup: destination }));
}
