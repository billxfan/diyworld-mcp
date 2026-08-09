import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { PetSocialStore } from "./store.mjs";

const PRESERVED_TABLES = [
  "owners",
  "devices",
  "pets",
  "friendships",
  "conversations",
  "messages",
  "read_cursors",
  "events",
  "event_acks",
  "event_receipts",
  "invite_codes",
  "invite_redemptions",
  "account_deletion_confirmations",
  "account_recovery_codes"
];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableNames(db) {
  return db
    .prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all()
    .map((row) => row.name);
}

function countRows(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
}

function tableCounts(db) {
  return Object.fromEntries(tableNames(db).map((table) => [table, countRows(db, table)]));
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    .map((column) => column.name);
}

function tableFingerprint(db, table, columns = tableColumns(db, table)) {
  const projection = columns.map(quoteIdentifier).join(", ") || "*";
  const rows = db
    .prepare(`SELECT ${projection} FROM ${quoteIdentifier(table)}`)
    .all();
  const encoded = rows
    .map((row) =>
      JSON.stringify(row, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    )
    .sort();
  return createHash("sha256").update(encoded.join("\n")).digest("hex");
}

function tableFingerprints(db, preservedColumns = {}) {
  return Object.fromEntries(
    tableNames(db).map((table) => [
      table,
      tableFingerprint(db, table, preservedColumns[table]),
    ])
  );
}

function pragmaRows(db, name) {
  return db.prepare(`PRAGMA ${name}`).all();
}

function inspectDatabase(db, preservedColumns = {}) {
  const counts = tableCounts(db);
  const columns = Object.fromEntries(
    tableNames(db).map((table) => [table, tableColumns(db, table)]),
  );
  const has = (table) => Object.hasOwn(counts, table);
  const scalar = (sql) => Number(db.prepare(sql).get().count);
  const integrityRows = pragmaRows(db, "integrity_check");
  const foreignKeyViolations = pragmaRows(db, "foreign_key_check");

  return {
    tableCounts: counts,
    tableColumns: columns,
    tableFingerprints: tableFingerprints(db),
    preservedTableFingerprints: tableFingerprints(db, preservedColumns),
    integrityOk:
      integrityRows.length === 1 &&
      String(integrityRows[0].integrity_check ?? "").toLowerCase() === "ok",
    foreignKeyViolationCount: foreignKeyViolations.length,
    identity: {
      pets: has("pets") ? counts.pets : 0,
      characters: has("characters") ? counts.characters : 0,
      devices: has("devices") ? counts.devices : 0,
      agentBindings: has("agent_bindings") ? counts.agent_bindings : 0,
      petsMissingCharacter:
        has("pets") && has("characters")
          ? scalar(`
              SELECT COUNT(*) AS count
              FROM pets p LEFT JOIN characters c ON c.id = p.id
              WHERE c.id IS NULL
            `)
          : null,
      devicesMissingBinding:
        has("devices") && has("agent_bindings")
          ? scalar(`
              SELECT COUNT(*) AS count
              FROM devices d LEFT JOIN agent_bindings b ON b.device_id = d.id
              WHERE b.id IS NULL
            `)
          : null,
      characterOwnerMismatches:
        has("pets") && has("characters")
          ? scalar(`
              SELECT COUNT(*) AS count
              FROM pets p JOIN characters c ON c.id = p.id
              WHERE c.owner_id <> p.owner_id
            `)
          : null,
      deviceBindingMismatches:
        has("devices") && has("pets") && has("agent_bindings")
          ? scalar(`
              SELECT COUNT(*) AS count
              FROM devices d
              LEFT JOIN pets p ON p.owner_id = d.owner_id
              LEFT JOIN agent_bindings b ON b.device_id = d.id
              WHERE p.id IS NULL OR b.id IS NULL OR b.character_id <> p.id
            `)
          : null
    }
  };
}

function sameCounts(left, right) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([table, count]) => right[table] === count)
  );
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

export async function rehearseAgentWorldMigration(sourceDatabase, options = {}) {
  const sourcePath = resolve(sourceDatabase);
  if (!existsSync(sourcePath)) throw new Error(`Database does not exist: ${sourcePath}`);

  const temporaryDirectory = options.copyPath
    ? null
    : mkdtempSync(join(tmpdir(), "agent-world-migration-"));
  const copyPath = resolve(options.copyPath ?? join(temporaryDirectory, basename(sourcePath)));
  if (copyPath === sourcePath) throw new Error("The rehearsal copy must not be the source database.");
  if (existsSync(copyPath)) throw new Error(`Refusing to overwrite an existing rehearsal copy: ${copyPath}`);

  let source;
  let firstStore;
  let secondStore;
  try {
    source = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5_000 });
    const sourceInspection = inspectDatabase(source);
    await backup(source, copyPath);
    source.close();
    source = null;

    const beforeDb = new DatabaseSync(copyPath, { readOnly: true, timeout: 5_000 });
    const before = inspectDatabase(beforeDb);
    beforeDb.close();

    firstStore = new PetSocialStore(copyPath);
    const afterFirst = inspectDatabase(firstStore.db, before.tableColumns);
    firstStore.close();
    firstStore = null;

    secondStore = new PetSocialStore(copyPath);
    const afterSecond = inspectDatabase(secondStore.db);
    secondStore.close();
    secondStore = null;

    const preserved = PRESERVED_TABLES
      .filter((table) => Object.hasOwn(before.tableCounts, table))
      .every((table) => before.tableCounts[table] === afterFirst.tableCounts[table]);
    const preservedContent = PRESERVED_TABLES
      .filter((table) => Object.hasOwn(before.tableFingerprints, table))
      .every(
        (table) =>
          before.tableFingerprints[table] ===
            afterFirst.preservedTableFingerprints[table]
      );
    const changedOnSecondPass = Object.keys(afterFirst.tableFingerprints).filter(
      (table) =>
        afterFirst.tableFingerprints[table] !== afterSecond.tableFingerprints[table]
    );
    const checks = [
      check("source_integrity", sourceInspection.integrityOk, "Source passed SQLite integrity_check."),
      check("migration_copy_integrity", afterFirst.integrityOk, "Migrated copy passed SQLite integrity_check."),
      check(
        "foreign_keys",
        afterFirst.foreignKeyViolationCount === 0,
        `${afterFirst.foreignKeyViolationCount} foreign-key violation(s) in migrated copy.`
      ),
      check(
        "legacy_rows_preserved",
        preserved,
        "Identity, social, message, event, invite, and recovery row counts are unchanged."
      ),
      check(
        "legacy_content_preserved",
        preservedContent,
        "Identity, social, message, event, invite, and recovery row contents are unchanged."
      ),
      check(
        "characters_backfilled",
        afterFirst.identity.petsMissingCharacter === 0,
        `${afterFirst.identity.petsMissingCharacter ?? "unknown"} Pet row(s) lack a Character mapping.`
      ),
      check(
        "bindings_backfilled",
        afterFirst.identity.devicesMissingBinding === 0 &&
          afterFirst.identity.deviceBindingMismatches === 0 &&
          afterFirst.identity.characterOwnerMismatches === 0,
        `${afterFirst.identity.devicesMissingBinding ?? "unknown"} missing binding(s), ${afterFirst.identity.deviceBindingMismatches ?? "unknown"} binding/Character mismatch(es), and ${afterFirst.identity.characterOwnerMismatches ?? "unknown"} Character owner mismatch(es).`
      ),
      check(
        "migration_idempotent",
        sameCounts(afterFirst.tableCounts, afterSecond.tableCounts) &&
          changedOnSecondPass.length === 0,
        changedOnSecondPass.length === 0
          ? "A second migration pass leaves all table counts and contents unchanged."
          : `A second migration pass changed content in: ${changedOnSecondPass.join(", ")}.`
      ),
      check(
        "second_pass_integrity",
        afterSecond.integrityOk && afterSecond.foreignKeyViolationCount === 0,
        "The twice-migrated copy remains internally consistent."
      )
    ];

    return {
      ok: checks.every((item) => item.ok),
      source: sourcePath,
      rehearsalCopy: options.copyPath ? copyPath : null,
      checks,
      before: { identity: before.identity },
      after: { identity: afterSecond.identity }
    };
  } finally {
    source?.close();
    firstStore?.close();
    secondStore?.close();
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
