import {
  migrateWorldRuntime,
  seedOfficialWorlds
} from "./venue-lab-core/database.js";

export function migrateSharedWorlds(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('official', 'user')),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL
        CHECK (visibility IN ('public', 'unlisted', 'hidden')),
      join_policy TEXT NOT NULL
        CHECK (join_policy IN ('open', 'approval', 'invite_only')),
      friend_policy TEXT NOT NULL
        CHECK (friend_policy IN ('enabled', 'disabled')),
      governance TEXT NOT NULL
        CHECK (governance IN ('immutable', 'owner', 'stewards', 'community')),
      owner_pet_id TEXT REFERENCES pets(id),
      profile_version INTEGER NOT NULL DEFAULT 1,
      current_spec_version INTEGER NOT NULL DEFAULT 1,
      current_rule_version INTEGER NOT NULL DEFAULT 1,
      delivery_mode TEXT NOT NULL DEFAULT 'legacy_broadcast'
        CHECK (delivery_mode IN ('legacy_broadcast', 'relevance_routed')),
      publication_status TEXT NOT NULL DEFAULT 'published'
        CHECK (publication_status IN ('draft', 'published', 'closed')),
      definition_text TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS space_rule_versions (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      rules_text TEXT NOT NULL,
      visibility TEXT NOT NULL,
      join_policy TEXT NOT NULL,
      friend_policy TEXT NOT NULL,
      governance TEXT NOT NULL,
      definition_text TEXT NOT NULL DEFAULT '',
      created_by_pet_id TEXT REFERENCES pets(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (space_id, version)
    );

    CREATE TABLE IF NOT EXISTS world_spec_versions (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      definition_text TEXT NOT NULL DEFAULT '',
      entry_prompt TEXT NOT NULL DEFAULT '',
      host_prompt TEXT NOT NULL DEFAULT '',
      resolution_mode TEXT NOT NULL DEFAULT 'direct'
        CHECK (resolution_mode IN ('direct', 'managed')),
      visibility TEXT NOT NULL,
      join_policy TEXT NOT NULL,
      friend_policy TEXT NOT NULL,
      created_by_pet_id TEXT REFERENCES pets(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (space_id, version)
    );

    CREATE TABLE IF NOT EXISTS space_stewards (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (space_id, pet_id)
    );

    CREATE TABLE IF NOT EXISTS space_memberships (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'active', 'rejected', 'withdrawn')),
      accepted_rule_version INTEGER,
      application_text TEXT NOT NULL DEFAULT '',
      delegation_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK (delegation_mode IN ('manual', 'paused')),
      last_seen_event_sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (space_id, pet_id)
    );

    CREATE TABLE IF NOT EXISTS presence (
      pet_id TEXT PRIMARY KEY REFERENCES pets(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      entered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS space_shares (
      token TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      created_by_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS space_invitations (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      inviter_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      invitee_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
      bypass_approval INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_states (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_by_pet_id TEXT REFERENCES pets(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_member_states (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_by_pet_id TEXT REFERENCES pets(id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (space_id, pet_id)
    );

    CREATE TABLE IF NOT EXISTS world_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL
        CHECK (actor_type IN ('pet', 'world', 'system')),
      actor_pet_id TEXT REFERENCES pets(id),
      event_class TEXT NOT NULL
        CHECK (event_class IN ('intent', 'outcome', 'system')),
      event_type TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      causation_event_id TEXT REFERENCES world_events(id),
      correlation_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'world'
        CHECK (visibility IN ('world', 'actor', 'managers')),
      audience_pet_id TEXT REFERENCES pets(id),
      spec_version INTEGER NOT NULL,
      idempotency_key TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_triggers (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      created_by_pet_id TEXT NOT NULL REFERENCES pets(id),
      trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('at', 'event')),
      trigger_at TEXT,
      event_type TEXT,
      instruction_text TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'world'
        CHECK (visibility IN ('world', 'actor', 'managers')),
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'fired', 'cancelled')),
      spec_version INTEGER NOT NULL,
      fired_event_id TEXT REFERENCES world_events(id),
      created_at TEXT NOT NULL,
      fired_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_pet_id TEXT REFERENCES pets(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_spaces_visibility
      ON spaces(visibility, updated_at);
    CREATE INDEX IF NOT EXISTS idx_memberships_pet_status
      ON space_memberships(pet_id, status);
    CREATE INDEX IF NOT EXISTS idx_presence_space
      ON presence(space_id, entered_at);
    CREATE INDEX IF NOT EXISTS idx_invitations_invitee_status
      ON space_invitations(invitee_pet_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_world_events_space_sequence
      ON world_events(space_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_world_events_causation
      ON world_events(causation_event_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_outcome_once
      ON world_events(causation_event_id)
      WHERE event_class = 'outcome' AND causation_event_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_events_idempotency
      ON world_events(space_id, actor_pet_id, idempotency_key)
      WHERE actor_pet_id IS NOT NULL AND idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_world_triggers_due
      ON world_triggers(space_id, status, trigger_kind, trigger_at);
  `);

  migrateWorldRuntime(db);
  seedOfficialWorlds(db);
}
