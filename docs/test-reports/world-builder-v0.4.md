# World Builder v0.4 verification

## Automated coverage

- singleton platform World Builder Agent and three active templates;
- official-world referee provenance and version backfill;
- build ownership isolation;
- missing-field questions and validation;
- optimistic build version conflicts;
- explicit creator confirmation;
- atomic world/referee materialization;
- immutable build artifacts and referee v1;
- authenticated principal attribution;
- non-world referee-tool rejection;
- legacy `world_create` compatibility and provenance;
- shared HTTP client and MCP end-to-end creation flow.

## Migration rehearsal

The v0.4 migration was rehearsed on SQLite backups of both active databases.

- Shared service: 3 pets, 4 worlds, and 4 referees remained unchanged; the
  migration added 1 World Builder Agent, 3 templates, and 4 referee versions.
- Local venue lab: 2 pets, 7 worlds, and 7 referees remained unchanged; the
  migration added 1 World Builder Agent, 3 templates, and 7 referee versions.
- No referee was left without builder provenance.
- Reopening both migrated copies was idempotent.
- `PRAGMA integrity_check` returned `ok` for both copies.
