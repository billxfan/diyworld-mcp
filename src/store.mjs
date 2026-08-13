import { DatabaseSync } from "node:sqlite";
import { AppError, invariant } from "./errors.mjs";
import {
  DAY_MS,
  hashToken,
  makeHandle,
  makeId,
  makeInviteCode,
  makeRecoveryCode,
  makeToken,
  pairKey,
  parseJson
} from "./utils.mjs";
import { migrateSharedWorlds } from "./world-database.mjs";

const CHARACTER_FORMS = new Set(["pet", "robot", "spirit", "humanlike", "custom"]);
const AGENT_PROVIDERS = new Set(["codex", "claude", "cursor", "custom", "other"]);
const DEFAULT_AGENT_BINDING_SCOPES = [
  "character:read",
  "character:write",
  "social:read",
  "social:write",
  "world:discover",
  "world:participate",
  "world:create",
  "world:admin"
];

function normalizeJsonObject(value, field, { maximumLength = 4_000 } = {}) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    `INVALID_${field.toUpperCase()}`,
    `${field} must be an object.`
  );
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new AppError(400, `INVALID_${field.toUpperCase()}`, `${field} must be JSON serializable.`);
  }
  invariant(
    encoded.length <= maximumLength,
    400,
    `INVALID_${field.toUpperCase()}`,
    `${field} is too large.`
  );
  return encoded;
}

export class PetSocialStore {
  constructor(filename = ":memory:", options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.db = new DatabaseSync(filename, { timeout: 5_000 });
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS owners (
        id TEXT PRIMARY KEY,
        recovery_email TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES owners(id),
        token_hash TEXT NOT NULL UNIQUE,
        public_name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'macos',
        bridge_version TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        codex_open INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at INTEGER,
        last_connected_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pets (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES owners(id),
        display_name TEXT NOT NULL,
        handle TEXT NOT NULL UNIQUE,
        bio TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'public',
        status TEXT NOT NULL DEFAULT 'active',
        last_codex_open_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        pair_key TEXT NOT NULL UNIQUE,
        requester_pet_id TEXT NOT NULL REFERENCES pets(id),
        addressee_pet_id TEXT NOT NULL REFERENCES pets(id),
        client_request_id TEXT,
        status TEXT NOT NULL,
        blocked_by_pet_id TEXT REFERENCES pets(id),
        cooldown_until INTEGER,
        expires_at INTEGER,
        accepted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(requester_pet_id, client_request_id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        friendship_id TEXT NOT NULL UNIQUE REFERENCES friendships(id),
        last_message_id TEXT,
        last_message_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        sender_pet_id TEXT NOT NULL REFERENCES pets(id),
        recipient_pet_id TEXT NOT NULL REFERENCES pets(id),
        client_message_id TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'message.text',
        content_text TEXT NOT NULL,
        sequence_no INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        read_at INTEGER,
        UNIQUE(sender_pet_id, client_message_id),
        UNIQUE(conversation_id, sequence_no)
      );

      CREATE TABLE IF NOT EXISTS read_cursors (
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        pet_id TEXT NOT NULL REFERENCES pets(id),
        max_sequence_no INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(conversation_id, pet_id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pet_id TEXT NOT NULL REFERENCES pets(id),
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        semantic_dedupe_key TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_acks (
        event_id INTEGER NOT NULL REFERENCES events(id),
        device_id TEXT NOT NULL REFERENCES devices(id),
        acked_at INTEGER NOT NULL,
        PRIMARY KEY(event_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS event_receipts (
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        delivered_at INTEGER,
        displayed_at INTEGER,
        read_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(event_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS invite_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'admin',
        issuer_owner_id TEXT REFERENCES owners(id),
        max_uses INTEGER NOT NULL DEFAULT 1 CHECK(max_uses > 0),
        use_count INTEGER NOT NULL DEFAULT 0 CHECK(use_count >= 0),
        expires_at INTEGER,
        disabled_at INTEGER,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invite_redemptions (
        id TEXT PRIMARY KEY,
        invite_id TEXT NOT NULL REFERENCES invite_codes(id),
        owner_id TEXT NOT NULL UNIQUE REFERENCES owners(id),
        redeemed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referral_invite_grants (
        owner_id TEXT PRIMARY KEY REFERENCES owners(id),
        invite_id TEXT NOT NULL UNIQUE REFERENCES invite_codes(id),
        registration_ordinal INTEGER NOT NULL UNIQUE,
        granted_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_deletion_confirmations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_recovery_codes (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY REFERENCES pets(id),
        owner_id TEXT NOT NULL REFERENCES owners(id),
        form TEXT NOT NULL DEFAULT 'pet',
        appearance_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        last_active_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_bindings (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id),
        device_id TEXT NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        client_instance_id TEXT,
        display_name TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_pets_owner_unique ON pets(owner_id);
      CREATE INDEX IF NOT EXISTS idx_events_pet_id ON events(pet_id, id);
      CREATE INDEX IF NOT EXISTS idx_event_receipts_device ON event_receipts(device_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_pet_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_pet_id, status);
      CREATE INDEX IF NOT EXISTS idx_pets_square ON pets(visibility, status, last_codex_open_at);
      CREATE INDEX IF NOT EXISTS idx_invite_redemptions_invite ON invite_redemptions(invite_id, redeemed_at);
      CREATE INDEX IF NOT EXISTS idx_account_deletion_owner ON account_deletion_confirmations(owner_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_account_recovery_owner ON account_recovery_codes(owner_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id, status);
      CREATE INDEX IF NOT EXISTS idx_characters_discovery ON characters(status, last_active_at);
      CREATE INDEX IF NOT EXISTS idx_agent_bindings_character ON agent_bindings(character_id, status);
    `);

    const eventColumns = this.db.prepare("PRAGMA table_info(events)").all();
    if (!eventColumns.some((column) => column.name === "semantic_dedupe_key")) {
      this.db.exec("ALTER TABLE events ADD COLUMN semantic_dedupe_key TEXT");
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_semantic_dedupe
        ON events(pet_id, semantic_dedupe_key)
        WHERE semantic_dedupe_key IS NOT NULL
    `);

    const inviteColumns = this.db.prepare("PRAGMA table_info(invite_codes)").all();
    if (!inviteColumns.some((column) => column.name === "kind")) {
      this.db.exec("ALTER TABLE invite_codes ADD COLUMN kind TEXT NOT NULL DEFAULT 'admin'");
    }
    if (!inviteColumns.some((column) => column.name === "issuer_owner_id")) {
      this.db.exec("ALTER TABLE invite_codes ADD COLUMN issuer_owner_id TEXT");
    }

    this.db.prepare(`
      INSERT OR IGNORE INTO characters (
        id, owner_id, form, appearance_json, status, last_active_at, created_at, updated_at
      )
      SELECT
        id, owner_id, 'pet', '{}', status, last_codex_open_at, created_at, updated_at
      FROM pets
    `).run();
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_bindings (
        id, character_id, device_id, provider, client_instance_id, display_name,
        scopes_json, status, last_seen_at, created_at, revoked_at
      )
      SELECT
        'bnd_' || d.id, p.id, d.id, 'codex', d.id, d.public_name,
        ?, d.status, d.last_connected_at, d.created_at,
        CASE WHEN d.status = 'active' THEN NULL ELSE d.last_connected_at END
      FROM devices d
      JOIN pets p ON p.owner_id = d.owner_id
    `).run(JSON.stringify(DEFAULT_AGENT_BINDING_SCOPES));

    migrateSharedWorlds(this.db);
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createInvite({ label = "", maxUses = 1, expiresAt = null } = {}) {
    const cleanLabel = String(label ?? "").trim();
    const uses = Number(maxUses);
    const expiry = expiresAt == null ? null : Number(expiresAt);
    invariant(cleanLabel.length <= 120, 400, "INVALID_INVITE_LABEL", "Invite label must be 120 characters or fewer.");
    invariant(Number.isSafeInteger(uses) && uses >= 1 && uses <= 1_000, 400, "INVALID_INVITE_USES", "Invite maxUses must be an integer between 1 and 1000.");
    invariant(expiry == null || (Number.isSafeInteger(expiry) && expiry > this.now()), 400, "INVALID_INVITE_EXPIRY", "Invite expiry must be in the future.");

    const id = makeId("inv");
    const code = makeInviteCode();
    const createdAt = this.now();
    this.db.prepare(`
      INSERT INTO invite_codes (id, code_hash, label, max_uses, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, hashToken(code), cleanLabel, uses, expiry, createdAt);
    return { id, code, label: cleanLabel, maxUses: uses, expiresAt: expiry, createdAt };
  }

  inviteStatus(invite, now = this.now()) {
    if (invite.disabled_at != null) return "disabled";
    if (invite.expires_at != null && invite.expires_at <= now) return "expired";
    if (invite.use_count >= invite.max_uses) return "exhausted";
    return "active";
  }

  publicInvite(invite) {
    return {
      id: invite.id,
      kind: invite.kind ?? "admin",
      issuerOwnerId: invite.issuer_owner_id ?? null,
      label: invite.label,
      maxUses: invite.max_uses,
      useCount: invite.use_count,
      remainingUses: Math.max(0, invite.max_uses - invite.use_count),
      expiresAt: invite.expires_at,
      disabledAt: invite.disabled_at,
      lastUsedAt: invite.last_used_at,
      createdAt: invite.created_at,
      status: this.inviteStatus(invite)
    };
  }

  listInvites() {
    return this.db.prepare("SELECT * FROM invite_codes ORDER BY created_at DESC, id DESC").all().map((invite) => this.publicInvite(invite));
  }

  disableInvite(inviteId) {
    const now = this.now();
    const result = this.db.prepare(`
      UPDATE invite_codes SET disabled_at = COALESCE(disabled_at, ?) WHERE id = ?
    `).run(now, inviteId);
    invariant(result.changes === 1, 404, "INVITE_NOT_FOUND", "Invite was not found.");
    return this.publicInvite(this.db.prepare("SELECT * FROM invite_codes WHERE id = ?").get(inviteId));
  }

  consumeInvite(inviteCode, ownerId, now = this.now()) {
    const invite = this.requireUsableInvite(inviteCode, now);

    const updated = this.db.prepare(`
      UPDATE invite_codes
      SET use_count = use_count + 1, last_used_at = ?
      WHERE id = ?
        AND disabled_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND use_count < max_uses
    `).run(now, invite.id, now);
    invariant(updated.changes === 1, 409, "INVITE_UNAVAILABLE", "The invite code is no longer available.");
    this.db.prepare(`
      INSERT INTO invite_redemptions (id, invite_id, owner_id, redeemed_at)
      VALUES (?, ?, ?, ?)
    `).run(makeId("ird"), invite.id, ownerId, now);
    return invite.id;
  }

  requireUsableInvite(inviteCode, now = this.now()) {
    invariant(inviteCode, 403, "INVITE_REQUIRED", "A valid invite code is required to register.");
    const invite = this.db.prepare("SELECT * FROM invite_codes WHERE code_hash = ?").get(hashToken(String(inviteCode).trim()));
    invariant(invite, 403, "INVALID_INVITE", "The invite code is invalid.");
    const status = this.inviteStatus(invite, now);
    invariant(status !== "disabled", 403, "INVITE_DISABLED", "The invite code has been disabled.");
    invariant(status !== "expired", 403, "INVITE_EXPIRED", "The invite code has expired.");
    invariant(status !== "exhausted", 409, "INVITE_EXHAUSTED", "The invite code has already been used.");
    return invite;
  }

  register({
    recoveryEmail,
    displayName,
    bio = "",
    visibility = "public",
    deviceName = "Mac",
    inviteCode,
    characterForm = "custom",
    appearance = {},
    agentProvider = "codex",
    clientInstanceId
  } = {}, options = {}) {
    const email = String(recoveryEmail ?? "").trim().toLowerCase();
    const name = String(displayName ?? "").trim();
    const cleanBio = String(bio ?? "").trim();
    invariant(email.includes("@"), 400, "INVALID_EMAIL", "A valid recovery email is required.");
    invariant(name.length >= 1 && name.length <= 24, 400, "INVALID_NAME", "World nickname must contain 1-24 characters.");
    invariant(cleanBio.length <= 160, 400, "INVALID_BIO", "Bio must be 160 characters or fewer.");
    invariant(["public", "friends_only", "private"].includes(visibility), 400, "INVALID_VISIBILITY", "Unsupported visibility.");
    const form = String(characterForm ?? "custom");
    const provider = String(agentProvider ?? "codex");
    invariant(CHARACTER_FORMS.has(form), 400, "INVALID_CHARACTER_FORM", "Unsupported character form.");
    invariant(AGENT_PROVIDERS.has(provider), 400, "INVALID_AGENT_PROVIDER", "Unsupported agent provider.");
    const appearanceJson = normalizeJsonObject(appearance ?? {}, "appearance");
    const registrationLimit = options.inviteRequired
      ? Number(options.registrationLimit ?? 1_000)
      : null;
    const referralInviteGrantLimit = options.inviteRequired
      ? Number(options.referralInviteGrantLimit ?? 500)
      : 0;
    invariant(
      registrationLimit == null ||
        (Number.isSafeInteger(registrationLimit) && registrationLimit >= 1),
      500,
      "INVALID_REGISTRATION_LIMIT",
      "Registration limit must be a positive integer.",
    );
    invariant(
      Number.isSafeInteger(referralInviteGrantLimit) &&
        referralInviteGrantLimit >= 0 &&
        (registrationLimit == null || referralInviteGrantLimit <= registrationLimit),
      500,
      "INVALID_REFERRAL_INVITE_LIMIT",
      "Referral invite grant limit must fit within the registration limit.",
    );

    const now = this.now();
    const ownerId = makeId("own");
    // The legacy pets table remains the storage compatibility layer, but new
    // public identities receive a neutral Character identifier.
    const petId = makeId("chr");
    const deviceId = makeId("dev");
    const bindingId = makeId("bnd");
    const token = makeToken();
    let referralInvite = null;
    let handle = makeHandle(name);
    while (this.db.prepare("SELECT 1 FROM pets WHERE handle = ?").get(handle)) {
      handle = makeHandle(name);
    }

    this.transaction(() => {
      const registrationOrdinal = Number(
        this.db.prepare("SELECT COUNT(*) AS count FROM owners").get().count,
      ) + 1;
      if (registrationLimit != null) {
        invariant(
          registrationOrdinal <= registrationLimit,
          409,
          "REGISTRATION_LIMIT_REACHED",
          `The invite-only validation is limited to ${registrationLimit} accounts.`,
        );
      }
      // Validate the invite before looking up the recovery email so an
      // unauthenticated caller cannot use an invalid invite as an email oracle.
      if (options.inviteRequired || inviteCode) {
        this.requireUsableInvite(inviteCode, now);
      }
      if (this.db.prepare("SELECT id FROM owners WHERE recovery_email = ?").get(email)) {
        throw new AppError(409, "ACCOUNT_EXISTS", "An account already exists for this recovery email. Contact support to recover it.");
      }
      this.db.prepare("INSERT INTO owners (id, recovery_email, created_at) VALUES (?, ?, ?)").run(ownerId, email, now);
      this.db.prepare(`
        INSERT INTO devices (id, owner_id, token_hash, public_name, platform, created_at)
        VALUES (?, ?, ?, ?, 'macos', ?)
      `).run(deviceId, ownerId, hashToken(token), String(deviceName).slice(0, 80), now);
      this.db.prepare(`
        INSERT INTO pets (id, owner_id, display_name, handle, bio, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(petId, ownerId, name, handle, cleanBio, visibility, now, now);
      this.db.prepare(`
        INSERT INTO characters (
          id, owner_id, form, appearance_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(petId, ownerId, form, appearanceJson, now, now);
      this.db.prepare(`
        INSERT INTO agent_bindings (
          id, character_id, device_id, provider, client_instance_id,
          display_name, scopes_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        bindingId,
        petId,
        deviceId,
        provider,
        clientInstanceId == null ? deviceId : String(clientInstanceId).slice(0, 200),
        String(deviceName).slice(0, 80),
        JSON.stringify(DEFAULT_AGENT_BINDING_SCOPES),
        now
      );
      if (options.inviteRequired || inviteCode) this.consumeInvite(inviteCode, ownerId, now);
      if (
        options.inviteRequired &&
        registrationOrdinal <= referralInviteGrantLimit
      ) {
        const referralInviteId = makeId("inv");
        const referralCode = makeInviteCode();
        this.db.prepare(`
          INSERT INTO invite_codes (
            id, code_hash, label, kind, issuer_owner_id, max_uses, created_at
          ) VALUES (?, ?, ?, 'referral', ?, 1, ?)
        `).run(
          referralInviteId,
          hashToken(referralCode),
          `第 ${registrationOrdinal} 位用户的裂变邀请码`,
          ownerId,
          now,
        );
        this.db.prepare(`
          INSERT INTO referral_invite_grants (
            owner_id, invite_id, registration_ordinal, granted_at
          ) VALUES (?, ?, ?, ?)
        `).run(ownerId, referralInviteId, registrationOrdinal, now);
        referralInvite = {
          id: referralInviteId,
          code: referralCode,
          maxUses: 1,
          registrationOrdinal,
          displayOnce: true,
        };
      }
    });

    const character = this.getCharacter(petId);
    const profile = this.getProfile(petId);
    const agentBinding = this.getAgentBindingById(bindingId);

    return {
      token,
      owner: { id: ownerId, recoveryEmail: email },
      device: { id: deviceId, name: deviceName, platform: "macos" },
      pet: { id: petId, name, handle: `@${handle}`, bio: cleanBio, visibility },
      character,
      profile,
      agentBinding,
      referralInvite,
    };
  }

  createAccountRecovery({ recoveryEmail, expiresAt } = {}) {
    const email = String(recoveryEmail ?? "").trim().toLowerCase();
    const expiry = Number(expiresAt);
    const createdAt = this.now();
    invariant(email.includes("@"), 400, "INVALID_EMAIL", "A valid recovery email is required.");
    invariant(
      Number.isSafeInteger(expiry) && expiry > createdAt && expiry <= createdAt + 7 * DAY_MS,
      400,
      "INVALID_RECOVERY_EXPIRY",
      "Recovery expiry must be within the next 7 days."
    );
    const owner = this.db.prepare(`
      SELECT o.id, o.recovery_email, p.id AS pet_id
      FROM owners o
      JOIN pets p ON p.owner_id = o.id AND p.status = 'active'
      WHERE o.recovery_email = ? AND o.status = 'active'
    `).get(email);
    invariant(owner, 404, "ACCOUNT_NOT_FOUND", "No active account exists for this recovery email.");

    const recoveryCode = makeRecoveryCode();
    this.transaction(() => {
      this.db.prepare(`
        UPDATE account_recovery_codes
        SET used_at = COALESCE(used_at, ?)
        WHERE owner_id = ? AND used_at IS NULL
      `).run(createdAt, owner.id);
      this.db.prepare(`
        INSERT INTO account_recovery_codes (
          id, owner_id, code_hash, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(makeId("rcv"), owner.id, hashToken(recoveryCode), expiry, createdAt);
    });
    return {
      recoveryCode,
      ownerId: owner.id,
      petId: owner.pet_id,
      expiresAt: expiry
    };
  }

  recoverAccount({
    recoveryEmail,
    recoveryCode,
    deviceName = "Recovered Agent",
    agentProvider = "codex",
    clientInstanceId
  } = {}) {
    const email = String(recoveryEmail ?? "").trim().toLowerCase();
    const code = String(recoveryCode ?? "").trim();
    const cleanDeviceName = String(deviceName ?? "").trim();
    const provider = String(agentProvider ?? "codex");
    invariant(email.includes("@"), 400, "INVALID_EMAIL", "A valid recovery email is required.");
    invariant(code, 400, "INVALID_RECOVERY_CODE", "A recovery code is required.");
    invariant(
      cleanDeviceName.length >= 1 && cleanDeviceName.length <= 80,
      400,
      "INVALID_DEVICE_NAME",
      "Device name must contain 1-80 characters."
    );
    invariant(AGENT_PROVIDERS.has(provider), 400, "INVALID_AGENT_PROVIDER", "Unsupported agent provider.");

    const now = this.now();
    const recovery = this.db.prepare(`
      SELECT r.*, o.recovery_email, o.status AS owner_status
      FROM account_recovery_codes r
      JOIN owners o ON o.id = r.owner_id
      WHERE r.code_hash = ? AND o.recovery_email = ?
    `).get(hashToken(code), email);
    invariant(
      recovery && recovery.used_at == null && recovery.owner_status === "active",
      403,
      "INVALID_RECOVERY_CODE",
      "The recovery code is invalid or has already been used."
    );
    invariant(
      recovery.expires_at > now,
      403,
      "RECOVERY_CODE_EXPIRED",
      "The recovery code has expired."
    );

    const pet = this.db.prepare(`
      SELECT * FROM pets WHERE owner_id = ? AND status = 'active'
    `).get(recovery.owner_id);
    invariant(pet, 404, "ACCOUNT_NOT_FOUND", "The account no longer has an active Character.");
    const token = makeToken();
    const deviceId = makeId("dev");
    const bindingId = makeId("bnd");
    this.transaction(() => {
      const consumed = this.db.prepare(`
        UPDATE account_recovery_codes
        SET used_at = ?
        WHERE id = ? AND used_at IS NULL AND expires_at > ?
      `).run(now, recovery.id, now);
      invariant(
        consumed.changes === 1,
        403,
        "INVALID_RECOVERY_CODE",
        "The recovery code is no longer available."
      );
      this.db.prepare(`
        INSERT INTO devices (id, owner_id, token_hash, public_name, platform, created_at)
        VALUES (?, ?, ?, ?, 'macos', ?)
      `).run(deviceId, recovery.owner_id, hashToken(token), cleanDeviceName, now);
      this.db.prepare(`
        INSERT INTO agent_bindings (
          id, character_id, device_id, provider, client_instance_id,
          display_name, scopes_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        bindingId,
        pet.id,
        deviceId,
        provider,
        clientInstanceId == null ? deviceId : String(clientInstanceId).slice(0, 200),
        cleanDeviceName,
        JSON.stringify(DEFAULT_AGENT_BINDING_SCOPES),
        now
      );
    });
    return {
      token,
      owner: { id: recovery.owner_id, recoveryEmail: email },
      device: { id: deviceId, name: cleanDeviceName, platform: "macos" },
      pet: {
        id: pet.id,
        name: pet.display_name,
        handle: `@${pet.handle}`,
        bio: pet.bio,
        visibility: pet.visibility
      },
      character: this.getCharacter(pet.id),
      profile: this.getProfile(pet.id),
      agentBinding: this.getAgentBindingById(bindingId)
    };
  }

  authenticate(token) {
    invariant(token, 401, "UNAUTHORIZED", "Missing bearer token.");
    const row = this.db.prepare(`
      SELECT
        d.id AS device_id, d.owner_id, d.status AS device_status,
        o.status AS owner_status,
        p.id AS pet_id, p.display_name, p.handle, p.visibility, p.status AS pet_status,
        c.id AS character_id, c.form AS character_form, c.status AS character_status,
        b.id AS binding_id, b.provider AS agent_provider,
        b.scopes_json, b.status AS binding_status
      FROM devices d
      JOIN owners o ON o.id = d.owner_id
      JOIN agent_bindings b ON b.device_id = d.id AND b.status = 'active'
      JOIN characters c ON c.id = b.character_id AND c.status = 'active'
      JOIN pets p ON p.id = c.id AND p.status = 'active'
      WHERE d.token_hash = ?
    `).get(hashToken(token));
    invariant(row && row.device_status === "active" && row.owner_status === "active", 401, "UNAUTHORIZED", "Invalid or revoked device token.");
    return {
      ...row,
      scopes: parseJson(row.scopes_json, [])
    };
  }

  heartbeat(auth, { codexOpen, bridgeVersion = "dev" }) {
    const result = this.agentHeartbeat(auth, {
      active: Boolean(codexOpen),
      clientVersion: bridgeVersion
    });
    return { receivedAt: result.receivedAt, codexOpen: result.active };
  }

  agentHeartbeat(auth, { active, clientVersion = "agent" }) {
    const now = this.now();
    this.transaction(() => {
      this.db.prepare(`
        UPDATE devices
        SET codex_open = ?, bridge_version = ?, last_heartbeat_at = ?, last_connected_at = ?
        WHERE id = ? AND status = 'active'
      `).run(active ? 1 : 0, String(clientVersion).slice(0, 40), now, now, auth.device_id);
      this.db.prepare(`
        UPDATE agent_bindings SET last_seen_at = ?
        WHERE id = ? AND status = 'active'
      `).run(now, auth.binding_id);
      if (active) {
        this.db.prepare("UPDATE pets SET last_codex_open_at = ?, updated_at = ? WHERE id = ?").run(now, now, auth.pet_id);
        this.db.prepare("UPDATE characters SET last_active_at = ?, updated_at = ? WHERE id = ?").run(now, now, auth.character_id);
      }
    });
    return { receivedAt: now, active: Boolean(active) };
  }

  getPet(petId) {
    return this.db.prepare("SELECT * FROM pets WHERE id = ?").get(petId);
  }

  getPetByHandle(handle) {
    return this.db.prepare("SELECT * FROM pets WHERE handle = ?").get(String(handle).replace(/^@/, ""));
  }

  getCharacter(characterId) {
    const row = this.db.prepare(`
      SELECT
        c.id, c.owner_id, c.form, c.appearance_json, c.status,
        c.last_active_at, c.created_at, c.updated_at,
        p.display_name, p.handle, p.bio, p.visibility
      FROM characters c
      JOIN pets p ON p.id = c.id
      WHERE c.id = ?
    `).get(characterId);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.display_name,
      handle: `@${row.handle}`,
      bio: row.bio,
      visibility: row.visibility,
      form: row.form,
      appearance: parseJson(row.appearance_json, {}),
      status: row.status,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  getProfile(profileId) {
    const character = this.getCharacter(profileId);
    if (!character) return undefined;
    return {
      id: character.id,
      name: character.name,
      handle: character.handle,
      bio: character.bio,
      visibility: character.visibility,
      lastActiveAt: character.lastActiveAt,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    };
  }

  getAgentBindingById(bindingId) {
    const row = this.db.prepare(`
      SELECT b.*, d.last_heartbeat_at, d.last_connected_at
      FROM agent_bindings b
      JOIN devices d ON d.id = b.device_id
      WHERE b.id = ?
    `).get(bindingId);
    if (!row) return undefined;
    return {
      id: row.id,
      characterId: row.character_id,
      provider: row.provider,
      clientInstanceId: row.client_instance_id,
      name: row.display_name,
      scopes: parseJson(row.scopes_json, []),
      status: row.status,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at
    };
  }

  getAgentBinding(auth) {
    const binding = this.getAgentBindingById(auth.binding_id);
    invariant(binding?.status === "active", 404, "AGENT_BINDING_NOT_FOUND", "Agent binding was not found.");
    return binding;
  }

  listAgentBindings(auth) {
    return this.db.prepare(`
      SELECT b.id
      FROM agent_bindings b
      JOIN characters c ON c.id = b.character_id
      WHERE c.owner_id = ?
      ORDER BY b.created_at ASC, b.id ASC
    `).all(auth.owner_id).map((row) => this.getAgentBindingById(row.id));
  }

  revokeAgentBinding(auth, bindingId, { confirmed = false } = {}) {
    invariant(confirmed === true, 400, "AGENT_BINDING_REVOCATION_NOT_CONFIRMED", "Agent binding revocation requires explicit confirmation.");
    invariant(bindingId !== auth.binding_id, 409, "CURRENT_AGENT_BINDING", "The current Agent binding cannot revoke itself. Use another active binding or account recovery.");
    const target = this.db.prepare(`
      SELECT b.*
      FROM agent_bindings b
      JOIN characters c ON c.id = b.character_id
      WHERE b.id = ? AND c.owner_id = ?
    `).get(bindingId, auth.owner_id);
    invariant(target, 404, "AGENT_BINDING_NOT_FOUND", "Agent binding was not found.");
    if (target.status === "revoked") {
      return { agentBinding: this.getAgentBindingById(bindingId), idempotent: true };
    }
    const now = this.now();
    this.transaction(() => {
      this.db.prepare(`
        UPDATE agent_bindings
        SET status = 'revoked', revoked_at = ?
        WHERE id = ? AND status = 'active'
      `).run(now, bindingId);
      this.db.prepare(`
        UPDATE devices SET status = 'revoked', codex_open = 0
        WHERE id = ?
      `).run(target.device_id);
    });
    return { agentBinding: this.getAgentBindingById(bindingId), idempotent: false };
  }

  updateCharacter(auth, patch = {}) {
    const currentPet = this.getPet(auth.character_id);
    const currentCharacter = this.getCharacter(auth.character_id);
    invariant(currentPet && currentCharacter, 404, "CHARACTER_NOT_FOUND", "Character was not found.");
    invariant(
      patch.displayName !== undefined ||
        patch.bio !== undefined ||
        patch.visibility !== undefined ||
        patch.form !== undefined ||
        patch.appearance !== undefined,
      400,
      "EMPTY_UPDATE",
      "At least one character profile field is required."
    );

    const name = patch.displayName === undefined ? currentPet.display_name : String(patch.displayName).trim();
    const bio = patch.bio === undefined ? currentPet.bio : String(patch.bio).trim();
    const visibility = patch.visibility === undefined ? currentPet.visibility : String(patch.visibility);
    const form = patch.form === undefined ? currentCharacter.form : String(patch.form);
    const appearanceJson = patch.appearance === undefined
      ? JSON.stringify(currentCharacter.appearance)
      : normalizeJsonObject(patch.appearance, "appearance");
    invariant(name.length >= 1 && name.length <= 24, 400, "INVALID_NAME", "World nickname must contain 1-24 characters.");
    invariant(bio.length <= 160, 400, "INVALID_BIO", "Bio must be 160 characters or fewer.");
    invariant(["public", "friends_only", "private"].includes(visibility), 400, "INVALID_VISIBILITY", "Unsupported visibility.");
    invariant(CHARACTER_FORMS.has(form), 400, "INVALID_CHARACTER_FORM", "Unsupported character form.");

    const now = this.now();
    this.transaction(() => {
      this.db.prepare(`
        UPDATE pets SET display_name = ?, bio = ?, visibility = ?, updated_at = ? WHERE id = ?
      `).run(name, bio, visibility, now, auth.character_id);
      this.db.prepare(`
        UPDATE characters SET form = ?, appearance_json = ?, updated_at = ? WHERE id = ?
      `).run(form, appearanceJson, now, auth.character_id);
    });
    return this.getCharacter(auth.character_id);
  }

  updateProfile(auth, patch = {}) {
    const { displayName, bio, visibility } = patch;
    const profile = this.updateCharacter(auth, { displayName, bio, visibility });
    return this.getProfile(profile.id);
  }

  updatePet(auth, patch = {}) {
    this.updateCharacter(auth, patch);
    return this.getPet(auth.pet_id);
  }

  getDevicesForOwner(ownerId) {
    return this.db.prepare("SELECT * FROM devices WHERE owner_id = ? AND status = 'active'").all(ownerId);
  }

  listSquare(auth, { recentWindowMs = 7 * DAY_MS, isReachable, limit = 20 }) {
    const now = this.now();
    const candidates = this.db.prepare(`
      SELECT p.*,
        f.id AS friendship_id,
        f.status AS friendship_status,
        f.requester_pet_id AS friendship_requester_pet_id,
        f.cooldown_until AS friendship_cooldown_until,
        f.expires_at AS friendship_expires_at
      FROM pets p
      LEFT JOIN friendships f
        ON f.pair_key = CASE
          WHEN p.id < ? THEN p.id || ':' || ?
          ELSE ? || ':' || p.id
        END
      WHERE p.visibility = 'public'
        AND p.status = 'active'
        AND p.id != ?
        AND p.last_codex_open_at IS NOT NULL
        AND p.last_codex_open_at >= ?
        AND (f.status IS NULL OR f.status != 'blocked')
      ORDER BY p.last_codex_open_at DESC, p.id ASC
      LIMIT ?
    `).all(auth.pet_id, auth.pet_id, auth.pet_id, auth.pet_id, now - recentWindowMs, limit * 4);

    const active = [];
    const recent = [];
    for (const pet of candidates) {
      let relationship = "none";
      if (pet.friendship_status === "accepted") {
        relationship = "friend";
      } else if (pet.friendship_status === "pending" && (!pet.friendship_expires_at || pet.friendship_expires_at > now)) {
        relationship = pet.friendship_requester_pet_id === auth.pet_id ? "outgoing_pending" : "incoming_pending";
      } else if (pet.friendship_status === "rejected" && pet.friendship_cooldown_until > now) {
        relationship = "cooldown";
      }
      const item = {
        id: pet.id,
        name: pet.display_name,
        handle: `@${pet.handle}`,
        bio: pet.bio,
        presence: isReachable(pet) ? "reachable" : "recent",
        relationship,
        canAdd: relationship === "none"
      };
      (item.presence === "reachable" ? active : recent).push(item);
    }
    const ranked = [...active, ...recent].slice(0, limit);
    return {
      active: ranked.filter((pet) => pet.presence === "reachable"),
      recent: ranked.filter((pet) => pet.presence === "recent")
    };
  }

  listCharacters(auth, { recentWindowMs = 7 * DAY_MS, isReachable, limit = 20 }) {
    const now = this.now();
    const candidates = this.db.prepare(`
      SELECT c.form, c.appearance_json, c.last_active_at, p.*,
        f.id AS friendship_id,
        f.status AS friendship_status,
        f.requester_pet_id AS friendship_requester_pet_id,
        f.cooldown_until AS friendship_cooldown_until,
        f.expires_at AS friendship_expires_at
      FROM characters c
      JOIN pets p ON p.id = c.id
      LEFT JOIN friendships f
        ON f.pair_key = CASE
          WHEN c.id < ? THEN c.id || ':' || ?
          ELSE ? || ':' || c.id
        END
      WHERE p.visibility = 'public'
        AND p.status = 'active'
        AND c.status = 'active'
        AND c.id != ?
        AND COALESCE(c.last_active_at, p.last_codex_open_at) IS NOT NULL
        AND COALESCE(c.last_active_at, p.last_codex_open_at) >= ?
        AND (f.status IS NULL OR f.status != 'blocked')
      ORDER BY COALESCE(c.last_active_at, p.last_codex_open_at) DESC, c.id ASC
      LIMIT ?
    `).all(
      auth.character_id,
      auth.character_id,
      auth.character_id,
      auth.character_id,
      now - recentWindowMs,
      limit * 4
    );

    const active = [];
    const recent = [];
    for (const character of candidates) {
      let relationship = "none";
      if (character.friendship_status === "accepted") {
        relationship = "friend";
      } else if (
        character.friendship_status === "pending" &&
        (!character.friendship_expires_at || character.friendship_expires_at > now)
      ) {
        relationship = character.friendship_requester_pet_id === auth.character_id
          ? "outgoing_pending"
          : "incoming_pending";
      } else if (
        character.friendship_status === "rejected" &&
        character.friendship_cooldown_until > now
      ) {
        relationship = "cooldown";
      }
      const item = {
        id: character.id,
        name: character.display_name,
        handle: `@${character.handle}`,
        bio: character.bio,
        form: character.form,
        appearance: parseJson(character.appearance_json, {}),
        presence: isReachable(character) ? "reachable" : "recent",
        relationship,
        canAdd: relationship === "none"
      };
      (item.presence === "reachable" ? active : recent).push(item);
    }
    const ranked = [...active, ...recent].slice(0, limit);
    return {
      active: ranked.filter((character) => character.presence === "reachable"),
      recent: ranked.filter((character) => character.presence === "recent")
    };
  }

  listPeople(auth, options = {}) {
    const people = this.listCharacters(auth, options);
    const profile = ({ form, appearance, ...person }) => person;
    return {
      active: people.active.map(profile),
      recent: people.recent.map(profile),
    };
  }

  createEvent(petId, eventType, payload, timestamp = this.now()) {
    const result = this.db.prepare(`
      INSERT INTO events (pet_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(petId, eventType, JSON.stringify(payload), timestamp);
    return {
      id: Number(result.lastInsertRowid),
      petId,
      type: eventType,
      payload,
      createdAt: timestamp
    };
  }

  sendFriendRequest(auth, { targetPetId, clientRequestId }) {
    invariant(clientRequestId, 400, "MISSING_IDEMPOTENCY_KEY", "clientRequestId is required.");
    const target = this.getPet(targetPetId);
    invariant(target && target.status === "active", 404, "PET_NOT_FOUND", "Target Character was not found.");
    invariant(target.id !== auth.pet_id, 400, "SELF_REQUEST", "A Character cannot add itself.");
    invariant(target.visibility === "public", 403, "PET_NOT_DISCOVERABLE", "This Character is not accepting public friend requests.");
    const key = pairKey(auth.pet_id, target.id);
    const now = this.now();

    return this.transaction(() => {
      let existing = this.db.prepare("SELECT * FROM friendships WHERE pair_key = ?").get(key);
      if (existing?.status === "pending" && existing.expires_at != null && existing.expires_at <= now) {
        this.db.prepare(`
          UPDATE friendships
          SET status = 'expired', updated_at = ?, version = version + 1
          WHERE id = ? AND status = 'pending'
        `).run(now, existing.id);
        existing = this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(existing.id);
      }
      if (existing) {
        if (existing.status === "accepted") {
          return { friendship: existing, events: [], idempotent: true };
        }
        if (existing.status === "blocked") {
          throw new AppError(403, "RELATIONSHIP_BLOCKED", "This relationship is blocked.");
        }
        if (existing.status === "pending") {
          if (existing.requester_pet_id === auth.pet_id) {
            return { friendship: existing, events: [], idempotent: true };
          }
          this.db.prepare(`
            UPDATE friendships SET status = 'accepted', accepted_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?
          `).run(now, now, existing.id);
          const conversationId = this.ensureConversation(existing.id, now);
          const events = [
            this.createEvent(auth.pet_id, "friendship.accepted", { friendshipId: existing.id, petId: target.id, conversationId }, now),
            this.createEvent(target.id, "friendship.accepted", { friendshipId: existing.id, petId: auth.pet_id, conversationId }, now)
          ];
          return { friendship: this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(existing.id), events, autoAccepted: true };
        }
        if (existing.cooldown_until && existing.cooldown_until > now) {
          throw new AppError(429, "FRIEND_REQUEST_COOLDOWN", "A previous request was rejected recently.", { retryAfterMs: existing.cooldown_until - now });
        }
        this.db.prepare(`
          UPDATE friendships
          SET requester_pet_id = ?, addressee_pet_id = ?, client_request_id = ?, status = 'pending',
              blocked_by_pet_id = NULL, cooldown_until = NULL, expires_at = ?, updated_at = ?, version = version + 1
          WHERE id = ?
        `).run(auth.pet_id, target.id, clientRequestId, now + 30 * DAY_MS, now, existing.id);
        const event = this.createEvent(target.id, "friendship.requested", { friendshipId: existing.id, fromPetId: auth.pet_id }, now);
        return { friendship: this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(existing.id), events: [event] };
      }

      const id = makeId("frn");
      this.db.prepare(`
        INSERT INTO friendships (
          id, pair_key, requester_pet_id, addressee_pet_id, client_request_id,
          status, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(id, key, auth.pet_id, target.id, clientRequestId, now + 30 * DAY_MS, now, now);
      const event = this.createEvent(target.id, "friendship.requested", { friendshipId: id, fromPetId: auth.pet_id }, now);
      return { friendship: this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(id), events: [event] };
    });
  }

  listFriendRequests(auth, direction = "incoming") {
    const column = direction === "outgoing" ? "requester_pet_id" : "addressee_pet_id";
    const otherColumn = direction === "outgoing" ? "addressee_pet_id" : "requester_pet_id";
    return this.db.prepare(`
      SELECT f.*, p.display_name AS other_name, p.handle AS other_handle, p.bio AS other_bio
      FROM friendships f
      JOIN pets p ON p.id = f.${otherColumn}
      WHERE f.${column} = ?
        AND f.status = 'pending'
        AND (f.expires_at IS NULL OR f.expires_at > ?)
      ORDER BY f.created_at DESC
    `).all(auth.pet_id, this.now()).map((row) => ({
      id: row.id,
      status: row.status,
      direction,
      pet: { id: direction === "outgoing" ? row.addressee_pet_id : row.requester_pet_id, name: row.other_name, handle: `@${row.other_handle}`, bio: row.other_bio },
      expiresAt: row.expires_at
    }));
  }

  ensureConversation(friendshipId, now = this.now()) {
    const existing = this.db.prepare("SELECT id FROM conversations WHERE friendship_id = ?").get(friendshipId);
    if (existing) return existing.id;
    const id = makeId("cnv");
    this.db.prepare("INSERT INTO conversations (id, friendship_id, created_at) VALUES (?, ?, ?)").run(id, friendshipId, now);
    return id;
  }

  respondFriendRequest(auth, friendshipId, decision) {
    invariant(["accept", "reject", "block"].includes(decision), 400, "INVALID_DECISION", "Decision must be accept, reject, or block.");
    const now = this.now();
    return this.transaction(() => {
      const relation = this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(friendshipId);
      invariant(relation, 404, "FRIENDSHIP_NOT_FOUND", "Friend request was not found.");
      invariant(relation.addressee_pet_id === auth.pet_id, 403, "NOT_ADDRESSEE", "Only the receiving Character can respond.");
      invariant(relation.status === "pending", 409, "FRIENDSHIP_NOT_PENDING", "This friend request is no longer pending.");
      invariant(!relation.expires_at || relation.expires_at > now, 409, "FRIENDSHIP_EXPIRED", "This friend request has expired.");

      const requesterId = relation.requester_pet_id;
      const events = [];
      if (decision === "accept") {
        this.db.prepare(`
          UPDATE friendships SET status = 'accepted', accepted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?
        `).run(now, now, relation.id);
        const conversationId = this.ensureConversation(relation.id, now);
        events.push(
          this.createEvent(requesterId, "friendship.accepted", { friendshipId: relation.id, petId: auth.pet_id, conversationId }, now),
          this.createEvent(auth.pet_id, "friendship.accepted", { friendshipId: relation.id, petId: requesterId, conversationId }, now)
        );
      } else if (decision === "reject") {
        this.db.prepare(`
          UPDATE friendships SET status = 'rejected', cooldown_until = ?, updated_at = ?, version = version + 1 WHERE id = ?
        `).run(now + 7 * DAY_MS, now, relation.id);
        events.push(this.createEvent(requesterId, "friendship.rejected", { friendshipId: relation.id, petId: auth.pet_id }, now));
      } else {
        this.db.prepare(`
          UPDATE friendships SET status = 'blocked', blocked_by_pet_id = ?, updated_at = ?, version = version + 1 WHERE id = ?
        `).run(auth.pet_id, now, relation.id);
      }
      return { friendship: this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(relation.id), events };
    });
  }

  listFriends(auth) {
    const rows = this.db.prepare(`
      SELECT f.*, c.id AS conversation_id,
        CASE WHEN f.requester_pet_id = ? THEN f.addressee_pet_id ELSE f.requester_pet_id END AS other_pet_id
      FROM friendships f
      LEFT JOIN conversations c ON c.friendship_id = f.id
      WHERE f.status = 'accepted' AND (f.requester_pet_id = ? OR f.addressee_pet_id = ?)
      ORDER BY f.accepted_at DESC
    `).all(auth.pet_id, auth.pet_id, auth.pet_id);
    return rows.map((row) => {
      const pet = this.getPet(row.other_pet_id);
      return { friendshipId: row.id, conversationId: row.conversation_id, pet: { id: pet.id, name: pet.display_name, handle: `@${pet.handle}`, bio: pet.bio } };
    });
  }

  removeFriend(auth, friendshipId) {
    const now = this.now();
    return this.transaction(() => {
      const relation = this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(friendshipId);
      invariant(relation, 404, "FRIENDSHIP_NOT_FOUND", "Friendship was not found.");
      invariant(
        relation.requester_pet_id === auth.pet_id || relation.addressee_pet_id === auth.pet_id,
        403,
        "NOT_PARTICIPANT",
        "Character is not part of this friendship."
      );
      invariant(relation.status === "accepted", 409, "FRIENDSHIP_NOT_ACCEPTED", "Only an accepted friendship can be removed.");
      this.db.prepare(`
        UPDATE friendships SET status = 'removed', updated_at = ?, version = version + 1 WHERE id = ?
      `).run(now, relation.id);
      const otherPetId = relation.requester_pet_id === auth.pet_id ? relation.addressee_pet_id : relation.requester_pet_id;
      const event = this.createEvent(otherPetId, "friendship.removed", { friendshipId: relation.id, petId: auth.pet_id }, now);
      return { friendship: this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(relation.id), events: [event] };
    });
  }

  blockPet(auth, targetPetId) {
    const target = this.getPet(targetPetId);
    invariant(target && target.status === "active", 404, "PET_NOT_FOUND", "Target Character was not found.");
    invariant(target.id !== auth.pet_id, 400, "SELF_BLOCK", "A Character cannot block itself.");
    const key = pairKey(auth.pet_id, target.id);
    const now = this.now();

    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM friendships WHERE pair_key = ?").get(key);
      if (existing?.status === "blocked") {
        return { friendship: existing, events: [], idempotent: true };
      }
      if (existing) {
        this.db.prepare(`
          UPDATE friendships
          SET status = 'blocked', blocked_by_pet_id = ?, updated_at = ?, version = version + 1
          WHERE id = ?
        `).run(auth.pet_id, now, existing.id);
        return { friendship: this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(existing.id), events: [] };
      }
      const id = makeId("frn");
      this.db.prepare(`
        INSERT INTO friendships (
          id, pair_key, requester_pet_id, addressee_pet_id, status,
          blocked_by_pet_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'blocked', ?, ?, ?)
      `).run(id, key, auth.pet_id, target.id, auth.pet_id, now, now);
      return { friendship: this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(id), events: [] };
    });
  }

  resolveTarget(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized) return undefined;
    return this.getPet(normalized) ?? this.getPetByHandle(normalized);
  }

  sendMessage(auth, { target, conversationId, clientMessageId, text }) {
    invariant(clientMessageId, 400, "MISSING_IDEMPOTENCY_KEY", "clientMessageId is required.");
    const body = String(text ?? "");
    invariant(body.trim().length >= 1 && body.length <= 2_000, 400, "INVALID_MESSAGE", "Message must contain 1-2000 non-whitespace characters.");
    const targetPet = target ? this.resolveTarget(target) : null;
    const now = this.now();

    return this.transaction(() => {
      const duplicate = this.db.prepare("SELECT * FROM messages WHERE sender_pet_id = ? AND client_message_id = ?").get(auth.pet_id, clientMessageId);
      if (duplicate) return { message: duplicate, events: [], idempotent: true };

      let conversation;
      if (conversationId) {
        conversation = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
      } else {
        invariant(targetPet, 404, "PET_NOT_FOUND", "Target Character was not found.");
        const relation = this.db.prepare("SELECT * FROM friendships WHERE pair_key = ? AND status = 'accepted'").get(pairKey(auth.pet_id, targetPet.id));
        invariant(relation, 403, "NOT_FRIENDS", "Only accepted friends can exchange messages.");
        conversation = this.db.prepare("SELECT * FROM conversations WHERE friendship_id = ?").get(relation.id);
      }
      invariant(conversation, 404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
      const relation = this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(conversation.friendship_id);
      invariant(relation?.status === "accepted", 403, "NOT_FRIENDS", "Only accepted friends can exchange messages.");
      invariant(relation.requester_pet_id === auth.pet_id || relation.addressee_pet_id === auth.pet_id, 403, "NOT_PARTICIPANT", "Character is not part of this conversation.");
      const recipientId = relation.requester_pet_id === auth.pet_id ? relation.addressee_pet_id : relation.requester_pet_id;
      if (targetPet) invariant(targetPet.id === recipientId, 409, "TARGET_MISMATCH", "Target does not match the conversation.");

      const next = this.db.prepare("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS value FROM messages WHERE conversation_id = ?").get(conversation.id).value;
      const id = makeId("msg");
      this.db.prepare(`
        INSERT INTO messages (
          id, conversation_id, sender_pet_id, recipient_pet_id, client_message_id,
          content_text, sequence_no, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
      `).run(id, conversation.id, auth.pet_id, recipientId, clientMessageId, body, next, now);
      this.db.prepare("UPDATE conversations SET last_message_id = ?, last_message_at = ? WHERE id = ?").run(id, now, conversation.id);
      const event = this.createEvent(recipientId, "message.created", {
        messageId: id,
        conversationId: conversation.id,
        senderPetId: auth.pet_id,
        text: body,
        sequenceNo: next,
        createdAt: now
      }, now);
      return { message: this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id), events: [event] };
    });
  }

  listInbox(auth, { limit = 50 } = {}) {
    return this.db.prepare(`
      SELECT m.*, sp.display_name AS sender_name, sp.handle AS sender_handle,
             rp.display_name AS recipient_name, rp.handle AS recipient_handle
      FROM messages m
      JOIN pets sp ON sp.id = m.sender_pet_id
      JOIN pets rp ON rp.id = m.recipient_pet_id
      WHERE m.sender_pet_id = ? OR m.recipient_pet_id = ?
      ORDER BY m.created_at DESC, m.sequence_no DESC
      LIMIT ?
    `).all(auth.pet_id, auth.pet_id, limit).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      sequenceNo: row.sequence_no,
      direction: row.sender_pet_id === auth.pet_id ? "outgoing" : "incoming",
      sender: { id: row.sender_pet_id, name: row.sender_name, handle: `@${row.sender_handle}` },
      recipient: { id: row.recipient_pet_id, name: row.recipient_name, handle: `@${row.recipient_handle}` },
      text: row.content_text,
      status: row.status,
      createdAt: row.created_at
    })).reverse();
  }

  listInboxPage(auth, { limit = 50, before = null } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const cursor = before == null ? null : Number(before);
    invariant(
      cursor == null || (Number.isSafeInteger(cursor) && cursor > 0),
      400,
      "INVALID_CURSOR",
      "Inbox cursor must be a positive stable cursor.",
    );
    const rows = this.db.prepare(`
      SELECT m.rowid AS cursor_id, m.*, sp.display_name AS sender_name, sp.handle AS sender_handle,
             rp.display_name AS recipient_name, rp.handle AS recipient_handle
      FROM messages m
      JOIN pets sp ON sp.id = m.sender_pet_id
      JOIN pets rp ON rp.id = m.recipient_pet_id
      WHERE (m.sender_pet_id = ? OR m.recipient_pet_id = ?)
        AND (? IS NULL OR m.rowid < ?)
      ORDER BY m.rowid DESC
      LIMIT ?
    `).all(auth.pet_id, auth.pet_id, cursor, cursor, boundedLimit + 1);
    const hasMore = rows.length > boundedLimit;
    const page = rows.slice(0, boundedLimit);
    return {
      messages: page.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        sequenceNo: row.sequence_no,
        direction: row.sender_pet_id === auth.pet_id ? "outgoing" : "incoming",
        sender: { id: row.sender_pet_id, name: row.sender_name, handle: `@${row.sender_handle}` },
        recipient: { id: row.recipient_pet_id, name: row.recipient_name, handle: `@${row.recipient_handle}` },
        text: row.content_text,
        status: row.status,
        createdAt: row.created_at,
      })),
      order: "newest_first",
      has_more: hasMore,
      next_cursor: hasMore ? String(page[page.length - 1].cursor_id) : null,
      complete: !hasMore,
    };
  }

  listEvents(auth, afterId = 0, limit = 200) {
    return this.db.prepare(`
      SELECT event.*, receipt.delivered_at, receipt.displayed_at,
        receipt.read_at
      FROM events event
      LEFT JOIN event_receipts receipt
        ON receipt.event_id = event.id AND receipt.device_id = ?
      WHERE event.pet_id = ? AND event.id > ?
      ORDER BY event.id ASC LIMIT ?
    `).all(auth.device_id, auth.pet_id, afterId, limit).map((row) => ({
      id: row.id,
      petId: row.pet_id,
      type: row.event_type,
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at,
      delivery: {
        state: row.read_at != null
          ? "read"
          : row.displayed_at != null
            ? "displayed"
            : row.delivered_at != null
              ? "delivered"
              : "queued",
        deliveredAt: row.delivered_at,
        displayedAt: row.displayed_at,
        readAt: row.read_at,
      },
    }));
  }

  listActivity(auth, { limit = 50, before = null, undisplayedOnly = false } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const cursor = before == null ? null : Number(before);
    invariant(
      cursor == null || (Number.isSafeInteger(cursor) && cursor > 0),
      400,
      "INVALID_CURSOR",
      "Activity cursor must be a positive stable cursor.",
    );
    const events = this.db.prepare(`
      SELECT event.*, receipt.delivered_at, receipt.displayed_at,
        receipt.read_at
      FROM events event
      LEFT JOIN event_receipts receipt
        ON receipt.event_id = event.id AND receipt.device_id = ?
      WHERE event.pet_id = ?
        AND (
          event.event_type = 'message.created'
          OR event.event_type = 'world.event_committed'
          OR event.event_type = 'world.interaction_opened'
        )
        AND (? IS NULL OR event.id < ?)
        AND (? = 0 OR receipt.displayed_at IS NULL)
      ORDER BY event.id DESC
      LIMIT ?
    `).all(auth.device_id, auth.pet_id, cursor, cursor, undisplayedOnly ? 1 : 0, boundedLimit);
    return events.map((row) => {
      const payload = parseJson(row.payload_json, {});
      const delivery = {
        state: row.read_at != null
          ? "read"
          : row.displayed_at != null
            ? "displayed"
            : row.delivered_at != null
              ? "delivered"
              : "queued",
        deliveredAt: row.delivered_at,
        displayedAt: row.displayed_at,
        readAt: row.read_at,
      };
      if (row.event_type === "message.created") {
        const message = this.db.prepare(`
          SELECT message.*, sender.display_name AS sender_name,
            sender.handle AS sender_handle
          FROM messages message
          JOIN pets sender ON sender.id = message.sender_pet_id
          WHERE message.id = ?
        `).get(payload.messageId);
        return {
          eventId: `evt_${row.id}`,
          sequence: Number(row.id),
          channel: "private_message",
          eventType: row.event_type,
          messageId: message?.id ?? payload.messageId ?? null,
          summary: message?.content_text ?? String(payload.text ?? ""),
          sender: message
            ? {
                id: message.sender_pet_id,
                name: message.sender_name,
                handle: `@${message.sender_handle}`,
              }
            : { id: payload.senderPetId ?? null, name: "未知角色", handle: "" },
          conversationId: message?.conversation_id ?? payload.conversationId ?? null,
          relevance: payload.relevance ?? "direct",
          relevanceReason: payload.relevanceReason ?? "private_message_received",
          deliveryPolicy: payload.deliveryPolicy ?? "action_required",
          actionRequired: payload.actionRequired ?? true,
          createdAt: row.created_at,
          delivery,
        };
      }
      return {
        eventId: `evt_${row.id}`,
        sequence: Number(row.id),
        channel: "world",
        eventType: row.event_type,
        summary:
          payload.targetCharacterId === auth.pet_id && payload.inputBodyText
            ? `${payload.actorName ?? "世界成员"}对你说：${payload.inputBodyText}`
            : payload.outcomeText ??
              payload.promptText ??
              payload.inputBodyText ??
              "所在世界有一条新动态。",
        world: {
          id: payload.worldId ?? null,
          name: payload.worldName ?? payload.worldId ?? "未知世界",
        },
        actor: payload.actorCharacterId
          ? {
              id: payload.actorCharacterId,
              name: payload.actorName ?? "世界成员",
            }
          : null,
        targetCharacterId: payload.targetCharacterId ?? null,
        outcomeEventId: payload.outcomeEventId ?? null,
        outcomeSequence: payload.outcomeSequence ?? null,
        interactionId: payload.interactionId ?? null,
        promptEventId: payload.promptEventId ?? null,
        replyToEventId:
          row.event_type === "world.interaction_opened"
            ? payload.promptEventId ?? null
            : null,
        sceneId: payload.sceneId ?? null,
        interactionMode: payload.interactionMode ?? null,
        interactionQuorum: payload.interactionQuorum ?? null,
        interactionClosesAt: payload.interactionClosesAt ?? null,
        interactionChoiceOptions: payload.interactionChoiceOptions ?? null,
        relevance:
          payload.relevance ??
          (payload.targetCharacterId === auth.pet_id ? "direct" : "legacy"),
        relevanceReason:
          payload.relevanceReason ??
          (payload.targetCharacterId === auth.pet_id
            ? "directed_speech_target"
            : "legacy_world_event"),
        deliveryPolicy: payload.deliveryPolicy ?? "immediate",
        actionRequired:
          payload.actionRequired ??
          (payload.targetCharacterId === auth.pet_id ||
            row.event_type === "world.interaction_opened"),
        reply: row.event_type === "world.interaction_opened" && payload.promptEventId
          ? {
              available: true,
              tool: "world_act",
              worldId: payload.worldId,
              replyToEventId: payload.promptEventId,
              sceneId: payload.sceneId ?? null,
            }
          : payload.targetCharacterId === auth.pet_id
            ? {
              available: true,
              tool: "world_say",
              worldId: payload.worldId,
              targetCharacterId: payload.actorCharacterId,
            }
            : { available: false },
        createdAt: row.created_at,
        delivery,
      };
    });
  }

  listActivityPage(auth, { limit = 50, before = null, undisplayedOnly = false } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const cursor = before == null ? null : Number(before);
    invariant(
      cursor == null || (Number.isSafeInteger(cursor) && cursor > 0),
      400,
      "INVALID_CURSOR",
      "Activity cursor must be a positive stable cursor.",
    );
    const events = this.db.prepare(`
      SELECT event.id
      FROM events event
      LEFT JOIN event_receipts receipt
        ON receipt.event_id = event.id AND receipt.device_id = ?
      WHERE event.pet_id = ?
        AND event.id IN (
          SELECT id FROM events
          WHERE pet_id = ?
            AND (
              event_type = 'message.created'
              OR event_type = 'world.event_committed'
              OR event_type = 'world.interaction_opened'
            )
        )
        AND (? IS NULL OR event.id < ?)
        AND (? = 0 OR receipt.displayed_at IS NULL)
      ORDER BY event.id DESC
      LIMIT ?
    `).all(auth.device_id, auth.pet_id, auth.pet_id, cursor, cursor, undisplayedOnly ? 1 : 0, boundedLimit + 1);
    const hasMore = events.length > boundedLimit;
    const page = events.slice(0, boundedLimit);
    const upper = page.length ? Number(page[0].id) + 1 : (cursor ?? Number.MAX_SAFE_INTEGER);
    return {
      items: this.listActivity(auth, { limit: boundedLimit, before: upper, undisplayedOnly }),
      order: "newest_first",
      has_more: hasMore,
      next_cursor: hasMore ? String(page[page.length - 1].id) : null,
      complete: !hasMore,
    };
  }

  markWorldNotificationsDisplayed(auth, { worldId, afterSequence, throughSequence }) {
    const after = Number(afterSequence);
    const through = Number(throughSequence);
    invariant(
      Number.isSafeInteger(after) && after >= 0 && Number.isSafeInteger(through) && through >= after,
      400,
      "INVALID_CURSOR",
      "Displayed World range must use valid after and through sequences.",
    );
    return this.transaction(() =>
      this.markWorldNotificationsDisplayedInTransaction(auth, {
        worldId,
        afterSequence: after,
        throughSequence: through,
      }),
    );
  }

  // The caller has already opened the encompassing transaction.  Keep receipt
  // writes here so an acknowledgement can atomically advance its World cursor
  // and mark only the page the client actually displayed.
  markWorldNotificationsDisplayedInTransaction(auth, { worldId, afterSequence, throughSequence }) {
    const after = Number(afterSequence);
    const through = Number(throughSequence);
    invariant(
      Number.isSafeInteger(after) && after >= 0 && Number.isSafeInteger(through) && through >= after,
      400,
      "INVALID_CURSOR",
      "Displayed World range must use valid after and through sequences.",
    );
    const timestamp = this.now();
    const rows = this.db.prepare(`
      SELECT event.id
      FROM events event
      WHERE event.pet_id = ?
        AND event.event_type IN ('world.event_committed', 'world.interaction_opened')
        AND json_extract(event.payload_json, '$.worldId') = ?
        AND (
          (
            event.event_type = 'world.event_committed'
            AND CAST(json_extract(event.payload_json, '$.outcomeSequence') AS INTEGER) > ?
            AND CAST(json_extract(event.payload_json, '$.outcomeSequence') AS INTEGER) <= ?
          )
          OR (
            event.event_type = 'world.interaction_opened'
            AND CAST(json_extract(event.payload_json, '$.promptSequence') AS INTEGER) > ?
            AND CAST(json_extract(event.payload_json, '$.promptSequence') AS INTEGER) <= ?
          )
        )
    `).all(auth.pet_id, worldId, after, through, after, through);
    for (const row of rows) {
      this._recordEventReceipt(auth, row.id, "delivered", timestamp);
      this._recordEventReceipt(auth, row.id, "displayed", timestamp);
    }
    return { displayed_event_ids: rows.map((row) => `evt_${row.id}`) };
  }

  _recordEventReceipt(auth, eventId, state, timestamp) {
    invariant(
      new Set(["delivered", "displayed", "read"]).has(state),
      400,
      "INVALID_EVENT_RECEIPT_STATE",
      "Event receipt state must be delivered, displayed, or read.",
    );
    const event = this.db
      .prepare("SELECT * FROM events WHERE id = ? AND pet_id = ?")
      .get(eventId, auth.pet_id);
    invariant(event, 404, "EVENT_NOT_FOUND", "Event was not found.");
    const existing = this.db.prepare(`
      SELECT delivered_at, displayed_at, read_at
      FROM event_receipts WHERE event_id = ? AND device_id = ?
    `).get(eventId, auth.device_id);
    // Receipts describe what this particular client has actually done.  Do not
    // manufacture intermediate states: a reader must first have displayed the
    // activity on this same device.
    if (state === "displayed" && !existing?.delivered_at && !existing?.displayed_at) {
      throw new AppError(409, "DELIVERY_REQUIRED", "Mark this activity delivered before marking it displayed.");
    }
    if (state === "read" && !existing?.displayed_at && !existing?.read_at) {
      throw new AppError(409, "DISPLAY_REQUIRED", "Display this activity on the current device before marking it read.");
    }
    const deliveredAt = timestamp;
    const displayedAt = state === "displayed" ? timestamp : null;
    const readAt = state === "read" ? timestamp : null;
    this.db.prepare(`
      INSERT INTO event_receipts (
        event_id, device_id, delivered_at, displayed_at, read_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, device_id) DO UPDATE SET
        delivered_at = COALESCE(event_receipts.delivered_at, excluded.delivered_at),
        displayed_at = COALESCE(event_receipts.displayed_at, excluded.displayed_at),
        read_at = COALESCE(event_receipts.read_at, excluded.read_at),
        updated_at = excluded.updated_at
    `).run(
      eventId,
      auth.device_id,
      deliveredAt,
      displayedAt,
      readAt,
      timestamp,
    );
    const emitted = [];
    if (event.event_type === "message.created") {
      const payload = parseJson(event.payload_json, {});
      const message = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(payload.messageId);
      if (message && message.status === "queued") {
        this.db.prepare("UPDATE messages SET status = 'delivered', delivered_at = ? WHERE id = ?")
          .run(timestamp, message.id);
        emitted.push(this.createEvent(message.sender_pet_id, "message.delivered", {
          messageId: message.id,
          conversationId: message.conversation_id,
          deliveredAt: timestamp,
        }, timestamp));
      }
      if (state === "read" && message && message.status !== "read") {
        this.db.prepare(`
          UPDATE messages SET status = 'read',
            delivered_at = COALESCE(delivered_at, ?),
            read_at = COALESCE(read_at, ?)
          WHERE id = ?
        `).run(timestamp, timestamp, message.id);
        emitted.push(this.createEvent(message.sender_pet_id, "message.read", {
          messageId: message.id,
          conversationId: message.conversation_id,
          readerPetId: auth.pet_id,
          readAt: timestamp,
        }, timestamp));
      }
    }
    const receipt = this.db.prepare(`
      SELECT delivered_at, displayed_at, read_at
      FROM event_receipts WHERE event_id = ? AND device_id = ?
    `).get(eventId, auth.device_id);
    return {
      eventId: `evt_${eventId}`,
      state: receipt.read_at != null
        ? "read"
        : receipt.displayed_at != null
          ? "displayed"
          : "delivered",
      deliveredAt: receipt.delivered_at,
      displayedAt: receipt.displayed_at,
      readAt: receipt.read_at,
      events: emitted,
    };
  }

  recordEventReceipt(auth, eventId, state) {
    const timestamp = this.now();
    return this.transaction(() =>
      this._recordEventReceipt(auth, eventId, state, timestamp)
    );
  }

  ackEvent(auth, eventId) {
    const now = this.now();
    return this.transaction(() => {
      const event = this.db.prepare("SELECT * FROM events WHERE id = ? AND pet_id = ?").get(eventId, auth.pet_id);
      invariant(event, 404, "EVENT_NOT_FOUND", "Event was not found.");
      this.db.prepare("INSERT OR IGNORE INTO event_acks (event_id, device_id, acked_at) VALUES (?, ?, ?)").run(eventId, auth.device_id, now);
      // An acknowledgement means the bridge has both received and shown the
      // item, but retain the two state transitions so the invariant is shared
      // with the explicit receipt endpoint.
      this._recordEventReceipt(auth, eventId, "delivered", now);
      const receipt = this._recordEventReceipt(auth, eventId, "displayed", now);
      return { acked: true, receipt, events: receipt.events };
    });
  }

  markRead(auth, conversationId, maxSequenceNo, { displayed = false } = {}) {
    const now = this.now();
    return this.transaction(() => {
      const conversation = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
      invariant(conversation, 404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
      const relation = this.db.prepare("SELECT * FROM friendships WHERE id = ?").get(conversation.friendship_id);
      invariant(relation && (relation.requester_pet_id === auth.pet_id || relation.addressee_pet_id === auth.pet_id), 403, "NOT_PARTICIPANT", "Character is not part of this conversation.");
      const requested = Number(maxSequenceNo);
      invariant(Number.isSafeInteger(requested) && requested >= 0, 400, "INVALID_SEQUENCE", "maxSequenceNo must be a non-negative safe integer.");
      const maximum = this.db.prepare(`
        SELECT COALESCE(MAX(sequence_no), 0) AS value
        FROM messages
        WHERE conversation_id = ?
      `).get(conversationId).value;
      const storedCurrent = this.db.prepare("SELECT max_sequence_no FROM read_cursors WHERE conversation_id = ? AND pet_id = ?").get(conversationId, auth.pet_id)?.max_sequence_no ?? 0;
      const current = Math.min(storedCurrent, maximum);
      const next = Math.max(current, Math.min(requested, maximum));
      if (next === current) return { conversationId, maxSequenceNo: next, events: [] };
      if (displayed === true) {
        const eventIds = this.db.prepare(`
          SELECT event.id FROM events event
          JOIN messages message
            ON message.id = json_extract(event.payload_json, '$.messageId')
          WHERE event.pet_id = ? AND event.event_type = 'message.created'
            AND message.conversation_id = ? AND message.recipient_pet_id = ?
            AND message.sequence_no > ? AND message.sequence_no <= ?
          ORDER BY message.sequence_no ASC
        `).all(auth.pet_id, conversationId, auth.pet_id, current, next);
        for (const { id } of eventIds) {
          this._recordEventReceipt(auth, id, "delivered", now);
          this._recordEventReceipt(auth, id, "displayed", now);
        }
      }
      const undisplayed = this.db.prepare(`
        SELECT message.id
        FROM messages message
        JOIN events event
          ON event.pet_id = ? AND event.event_type = 'message.created'
          AND json_extract(event.payload_json, '$.messageId') = message.id
        LEFT JOIN event_receipts receipt
          ON receipt.event_id = event.id AND receipt.device_id = ?
        WHERE message.conversation_id = ? AND message.recipient_pet_id = ?
          AND message.sequence_no > ? AND message.sequence_no <= ?
          AND receipt.displayed_at IS NULL
        LIMIT 1
      `).get(auth.pet_id, auth.device_id, conversationId, auth.pet_id, current, next);
      invariant(
        !undisplayed,
        409,
        "DISPLAY_REQUIRED",
        "Display every message on the current device before marking this conversation read.",
      );
      this.db.prepare(`
        INSERT INTO read_cursors (conversation_id, pet_id, max_sequence_no, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(conversation_id, pet_id)
        DO UPDATE SET max_sequence_no = excluded.max_sequence_no, updated_at = excluded.updated_at
      `).run(conversationId, auth.pet_id, next, now);
      this.db.prepare(`
        UPDATE messages SET status = 'read', read_at = COALESCE(read_at, ?)
        WHERE conversation_id = ? AND recipient_pet_id = ?
          AND sequence_no > ? AND sequence_no <= ?
      `).run(now, conversationId, auth.pet_id, current, next);
      this.db.prepare(`
        UPDATE event_receipts
        SET read_at = COALESCE(read_at, ?), updated_at = ?
        WHERE device_id = ? AND displayed_at IS NOT NULL
          AND event_id IN (
            SELECT event.id FROM events event
            JOIN messages message
              ON message.id = json_extract(event.payload_json, '$.messageId')
            WHERE event.pet_id = ? AND event.event_type = 'message.created'
              AND message.conversation_id = ? AND message.recipient_pet_id = ?
              AND message.sequence_no > ? AND message.sequence_no <= ?
          )
      `).run(
        now,
        now,
        auth.device_id,
        auth.pet_id,
        conversationId,
        auth.pet_id,
        current,
        next,
      );
      const senderIds = this.db.prepare(`
        SELECT DISTINCT sender_pet_id FROM messages
        WHERE conversation_id = ? AND recipient_pet_id = ?
          AND sequence_no > ? AND sequence_no <= ?
      `).all(conversationId, auth.pet_id, current, next).map((row) => row.sender_pet_id);
      const events = senderIds.map((petId) => this.createEvent(petId, "message.read", { conversationId, readerPetId: auth.pet_id, maxSequenceNo: next, readAt: now }, now));
      return { conversationId, maxSequenceNo: next, events };
    });
  }

  requestAccountDeletion(auth, { ttlMs = 10 * 60 * 1000 } = {}) {
    const now = this.now();
    const confirmationToken = makeToken();
    const expiresAt = now + ttlMs;
    this.transaction(() => {
      this.db.prepare("DELETE FROM account_deletion_confirmations WHERE owner_id = ?").run(auth.owner_id);
      this.db.prepare(`
        INSERT INTO account_deletion_confirmations (id, owner_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(makeId("del"), auth.owner_id, hashToken(confirmationToken), expiresAt, now);
    });
    return {
      confirmationToken,
      confirmationText: "确认注销",
      expiresAt,
      warning: "注销不可恢复。好友关系和个人资料将被清除，当前角色创建的世界会关闭；联系人已收到的历史消息会保留并显示为“账号已注销”。"
    };
  }

  deleteAccount(auth, { confirmationToken, confirmationText } = {}) {
    invariant(String(confirmationText ?? "").trim() === "确认注销", 400, "ACCOUNT_DELETION_NOT_CONFIRMED", "The second confirmation text must be exactly 确认注销.");
    invariant(confirmationToken, 400, "MISSING_DELETION_TOKEN", "A valid account deletion confirmation token is required.");
    const now = this.now();
    const confirmation = this.db.prepare(`
      SELECT * FROM account_deletion_confirmations
      WHERE owner_id = ? AND token_hash = ?
    `).get(auth.owner_id, hashToken(String(confirmationToken)));
    invariant(confirmation, 403, "INVALID_DELETION_TOKEN", "The account deletion confirmation token is invalid.");
    invariant(confirmation.expires_at > now, 410, "DELETION_TOKEN_EXPIRED", "The account deletion confirmation token has expired.");

    return this.transaction(() => {
      const pet = this.getPet(auth.pet_id);
      invariant(pet?.status === "active", 409, "ACCOUNT_NOT_ACTIVE", "The account is not active.");
      const contacts = this.db.prepare(`
        SELECT
          CASE WHEN requester_pet_id = ? THEN addressee_pet_id ELSE requester_pet_id END AS pet_id
        FROM friendships
        WHERE status = 'accepted'
          AND (requester_pet_id = ? OR addressee_pet_id = ?)
      `).all(auth.pet_id, auth.pet_id, auth.pet_id);
      const events = contacts
        .filter(({ pet_id: petId }) => this.getPet(petId)?.status === "active")
        .map(({ pet_id: petId }) => this.createEvent(petId, "account.deleted", { petId: auth.pet_id }, now));

      this.db.prepare("DELETE FROM event_acks WHERE event_id IN (SELECT id FROM events WHERE pet_id = ?)").run(auth.pet_id);
      this.db.prepare("DELETE FROM event_receipts WHERE event_id IN (SELECT id FROM events WHERE pet_id = ?)").run(auth.pet_id);
      this.db.prepare("DELETE FROM events WHERE pet_id = ?").run(auth.pet_id);
      this.db.prepare("DELETE FROM read_cursors WHERE pet_id = ?").run(auth.pet_id);
      this.db.prepare("DELETE FROM account_deletion_confirmations WHERE owner_id = ?").run(auth.owner_id);
      this.db.prepare("DELETE FROM invite_redemptions WHERE owner_id = ?").run(auth.owner_id);
      this.db.prepare("DELETE FROM devices WHERE owner_id = ?").run(auth.owner_id);
      this.db.prepare(`
        DELETE FROM presence
        WHERE pet_id = ?
          OR space_id IN (
            SELECT id FROM spaces WHERE owner_pet_id = ? AND kind = 'user'
          )
      `).run(auth.pet_id, auth.pet_id);
      this.db.prepare(`
        UPDATE space_memberships
        SET status = 'withdrawn', updated_at = ?
        WHERE pet_id = ?
          OR space_id IN (
            SELECT id FROM spaces WHERE owner_pet_id = ? AND kind = 'user'
          )
      `).run(new Date(now).toISOString(), auth.pet_id, auth.pet_id);
      this.db.prepare(`
        UPDATE space_invitations
        SET status = 'revoked', updated_at = ?
        WHERE status = 'pending'
          AND (inviter_pet_id = ? OR invitee_pet_id = ?)
      `).run(new Date(now).toISOString(), auth.pet_id, auth.pet_id);
      this.db.prepare("DELETE FROM space_stewards WHERE pet_id = ?").run(auth.pet_id);
      this.db.prepare(`
        DELETE FROM space_shares
        WHERE space_id IN (
          SELECT id FROM spaces WHERE owner_pet_id = ? AND kind = 'user'
        )
      `).run(auth.pet_id);
      this.db.prepare(`
        UPDATE world_triggers
        SET status = 'cancelled'
        WHERE status = 'scheduled'
          AND space_id IN (
            SELECT id FROM spaces WHERE owner_pet_id = ? AND kind = 'user'
          )
      `).run(auth.pet_id);
      this.db.prepare(`
        UPDATE spaces
        SET publication_status = 'closed', updated_at = ?
        WHERE owner_pet_id = ? AND kind = 'user'
      `).run(new Date(now).toISOString(), auth.pet_id);
      this.db.prepare(`
        UPDATE friendships
        SET status = 'removed', blocked_by_pet_id = NULL, cooldown_until = NULL,
            expires_at = NULL, updated_at = ?, version = version + 1
        WHERE requester_pet_id = ? OR addressee_pet_id = ?
      `).run(now, auth.pet_id, auth.pet_id);
      this.db.prepare(`
        UPDATE pets
        SET display_name = '账号已注销', handle = ?, bio = '', visibility = 'private',
            status = 'deleted', last_codex_open_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(makeHandle("deleted-account"), now, auth.pet_id);
      this.db.prepare(`
        UPDATE characters
        SET form = 'custom', appearance_json = '{}', status = 'deleted',
            last_active_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, auth.character_id);
      this.db.prepare(`
        UPDATE owners SET recovery_email = ?, status = 'deleted' WHERE id = ?
      `).run(`${makeId("deleted")}@invalid.local`, auth.owner_id);

      return {
        deleted: true,
        deletedAt: now,
        petId: auth.pet_id,
        historyRetainedForContacts: true,
        events
      };
    });
  }
}

export const AgentWorldStore = PetSocialStore;
