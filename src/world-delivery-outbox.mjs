const DELIVERY_MODES = new Set(["legacy_broadcast", "relevance_routed"]);
const OUTBOX_EVENT_TYPES = new Set([
  "world.event_committed",
  "world.interaction_opened",
]);

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueDescriptors(items) {
  const unique = new Map();
  for (const item of items) {
    if (!item?.petId) continue;
    const existing = unique.get(item.petId);
    const existingScope = existing?.contentScope ?? "full";
    const itemScope = item.contentScope ?? "full";
    if (
      !existing ||
      (existingScope === "state_change_only" && itemScope === "full") ||
      item.actionRequired === true ||
      (item.deliveryPolicy === "immediate" && itemScope === existingScope)
    ) {
      unique.set(item.petId, item);
    }
  }
  return [...unique.values()];
}

export function migrateWorldDeliveryOutbox(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_delivery_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_world_event_id TEXT NOT NULL REFERENCES world_events(id) ON DELETE CASCADE,
      source_interaction_id TEXT REFERENCES world_interactions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('world.event_committed', 'world.interaction_opened')),
      delivery_mode TEXT NOT NULL
        CHECK (delivery_mode IN ('legacy_broadcast', 'relevance_routed')),
      dedupe_key TEXT NOT NULL UNIQUE,
      envelope_json TEXT NOT NULL DEFAULT '{}',
      recipient_snapshot_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT,
      dead_letter_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_world_delivery_outbox_pending
      ON world_delivery_outbox(status, id);
    CREATE INDEX IF NOT EXISTS idx_world_delivery_outbox_world
      ON world_delivery_outbox(space_id, status, id);
  `);
  const columns = db.prepare("PRAGMA table_info(world_delivery_outbox)").all();
  if (!columns.some((column) => column.name === "recipient_snapshot_json")) {
    db.exec("ALTER TABLE world_delivery_outbox ADD COLUMN recipient_snapshot_json TEXT");
  }
  if (!columns.some((column) => column.name === "next_attempt_at")) {
    db.exec("ALTER TABLE world_delivery_outbox ADD COLUMN next_attempt_at TEXT");
  }
  if (!columns.some((column) => column.name === "dead_letter_at")) {
    db.exec("ALTER TABLE world_delivery_outbox ADD COLUMN dead_letter_at TEXT");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_world_delivery_outbox_retry
      ON world_delivery_outbox(status, dead_letter_at, next_attempt_at, id);
  `);
}

export function worldDeliveryMode(db, worldId) {
  const mode = db
    .prepare("SELECT delivery_mode FROM spaces WHERE id = ?")
    .get(worldId)?.delivery_mode;
  return DELIVERY_MODES.has(mode) ? mode : "legacy_broadcast";
}

export function enqueueWorldDelivery(db, {
  worldId,
  sourceWorldEventId,
  sourceInteractionId = null,
  eventType,
  envelope = {},
  dedupeKey,
  deliveryMode = worldDeliveryMode(db, worldId),
  timestamp = new Date().toISOString(),
}) {
  if (!OUTBOX_EVENT_TYPES.has(eventType)) {
    throw new TypeError(`Unsupported World delivery event type: ${eventType}`);
  }
  if (!DELIVERY_MODES.has(deliveryMode)) {
    throw new TypeError(`Unsupported World delivery mode: ${deliveryMode}`);
  }
  if (!worldId || !sourceWorldEventId || !dedupeKey) {
    throw new TypeError("World delivery requires world, source event, and dedupe key.");
  }
  db.prepare(`
    INSERT OR IGNORE INTO world_delivery_outbox (
      space_id, source_world_event_id, source_interaction_id, event_type,
      delivery_mode, dedupe_key, envelope_json, status, attempt_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(
    worldId,
    sourceWorldEventId,
    sourceInteractionId,
    eventType,
    deliveryMode,
    dedupeKey,
    JSON.stringify(envelope),
    timestamp,
    timestamp,
  );
  const row = db
    .prepare("SELECT * FROM world_delivery_outbox WHERE dedupe_key = ?")
    .get(dedupeKey);
  snapshotWorldDeliveryRecipients(db, row.id);
  return db
    .prepare("SELECT * FROM world_delivery_outbox WHERE id = ?")
    .get(row.id);
}

function managers(db, worldId) {
  return db.prepare(`
    SELECT owner_pet_id AS pet_id FROM spaces
    WHERE id = ? AND owner_pet_id IS NOT NULL
    UNION
    SELECT pet_id FROM space_stewards WHERE space_id = ?
  `).all(worldId, worldId).map((row) => row.pet_id);
}

function activeMembers(db, worldId) {
  return db.prepare(`
    SELECT pet_id FROM space_memberships
    WHERE space_id = ? AND status = 'active'
  `).all(worldId).map((row) => row.pet_id);
}

function presentMembers(db, worldId) {
  return db.prepare(`
    SELECT DISTINCT membership.pet_id
    FROM space_memberships membership
    JOIN presence ON presence.pet_id = membership.pet_id
      AND presence.space_id = membership.space_id
    WHERE membership.space_id = ? AND membership.status = 'active'
  `).all(worldId).map((row) => row.pet_id);
}

function interactionParticipants(db, worldId, interactionId) {
  if (!interactionId) return [];
  const interaction = db.prepare(`
    SELECT scene_id FROM world_interactions WHERE id = ? AND space_id = ?
  `).get(interactionId, worldId);
  if (interaction?.scene_id) {
    return db.prepare(`
      SELECT DISTINCT pet_id FROM world_scene_participants
      WHERE scene_id = ? AND space_id = ?
        AND status IN ('invited', 'active')
    `).all(interaction.scene_id, worldId).map((row) => row.pet_id);
  }
  return db.prepare(`
    SELECT DISTINCT actor_pet_id AS pet_id FROM world_inputs
    WHERE space_id = ? AND interaction_id = ?
  `).all(worldId, interactionId).map((row) => row.pet_id);
}

function interactionAudience(db, worldId, interactionId) {
  const snapshotted = db.prepare(`
    SELECT recipient_snapshot_json FROM world_delivery_outbox
    WHERE space_id = ? AND source_interaction_id = ?
      AND event_type = 'world.interaction_opened'
    ORDER BY id ASC LIMIT 1
  `).get(worldId, interactionId);
  const snapshotPetIds = parseArray(snapshotted?.recipient_snapshot_json)
    .map((item) => item?.petId)
    .filter(Boolean);
  return [...new Set([
    ...snapshotPetIds,
    ...interactionParticipants(db, worldId, interactionId),
  ])];
}

function sceneParticipants(db, worldId, sceneId) {
  if (!sceneId) return [];
  return db.prepare(`
    SELECT DISTINCT pet_id FROM world_scene_participants
    WHERE scene_id = ? AND space_id = ?
      AND status IN ('invited', 'active')
  `).all(sceneId, worldId).map((row) => row.pet_id);
}

function descriptor(petId, overrides = {}) {
  return {
    petId,
    relevance: "contextual",
    relevanceReason: "world_story_update",
    deliveryPolicy: "ambient",
    actionRequired: false,
    ...overrides,
  };
}

export function resolveWorldDeliveryRecipients(db, row) {
  const envelope = parseObject(row.envelope_json ?? row.envelope);
  const worldId = row.space_id ?? envelope.worldId;
  const visibility = envelope.visibility ?? "world";
  const actorPetId = envelope.actorPetId ?? null;
  const committedSceneId = row.source_world_event_id
    ? db.prepare(`
        SELECT scene_id FROM world_events WHERE id = ? AND space_id = ?
      `).get(row.source_world_event_id, worldId)?.scene_id ?? null
    : null;
  const sceneId = committedSceneId ?? envelope.sceneId ?? null;

  if (row.delivery_mode === "legacy_broadcast") {
    if (visibility === "actor") {
      return actorPetId ? [descriptor(actorPetId, {
        relevance: "legacy",
        relevanceReason: "legacy_actor_event",
        deliveryPolicy: "immediate",
      })] : [];
    }
    if (visibility === "managers") {
      return managers(db, worldId).map((petId) => descriptor(petId, {
        relevance: "manager",
        relevanceReason: "world_management",
        deliveryPolicy: "immediate",
      }));
    }
    return activeMembers(db, worldId).map((petId) => descriptor(petId, {
      relevance: "legacy",
      relevanceReason: "legacy_world_broadcast",
      deliveryPolicy: "immediate",
    }));
  }

  if (visibility === "actor") {
    return actorPetId ? [descriptor(actorPetId, {
      relevance: "self",
      relevanceReason: "actor_private_result",
      deliveryPolicy: "digest",
    })] : [];
  }

  if (visibility === "managers") {
    return uniqueDescriptors(managers(db, worldId).map((petId) => descriptor(petId, {
      relevance: "manager",
      relevanceReason: "world_management",
      deliveryPolicy: "immediate",
    })));
  }

  if (row.event_type === "world.interaction_opened") {
    const interaction = db.prepare(`
      SELECT created_by_pet_id, scene_id FROM world_interactions
      WHERE id = ? AND space_id = ?
    `).get(envelope.interactionId, worldId);
    const recipients = interaction?.scene_id
      ? interactionParticipants(db, worldId, envelope.interactionId)
      : presentMembers(db, worldId).filter(
          (petId) => petId !== interaction?.created_by_pet_id,
        );
    return uniqueDescriptors(recipients.map((petId) => descriptor(petId, {
      relevance: "collective",
      relevanceReason: "collective_response_invited",
      deliveryPolicy: "immediate",
      actionRequired: false,
    })));
  }

  const recipients = [];
  if (envelope.interactionId) {
    recipients.push(
      ...interactionAudience(db, worldId, envelope.interactionId)
        .map((petId) => descriptor(petId, {
          relevance: "collective",
          relevanceReason: "collective_participant_result",
          deliveryPolicy: "immediate",
        })),
    );
  }

  const input = envelope.inputId
    ? db.prepare(`
        SELECT actor_pet_id, event_type, data_json FROM world_inputs
        WHERE id = ? AND space_id = ?
      `).get(envelope.inputId, worldId)
    : null;
  const data = parseObject(input?.data_json)?.data ?? {};
  const inputActorId = input?.actor_pet_id ?? actorPetId;
  const targetId = data.target_character_id ?? data.target_pet_id ?? null;
  if (inputActorId) {
    recipients.push(descriptor(inputActorId, {
      relevance: "self",
      relevanceReason: "own_action_result",
      deliveryPolicy: "digest",
    }));
  }
  const judgement = row.source_world_event_id
    ? db.prepare(`
        SELECT world_state_before_version, world_state_after_version
        FROM world_judgements WHERE outcome_event_id = ?
        UNION ALL
        SELECT world_state_before_version, world_state_after_version
        FROM world_interaction_resolutions WHERE outcome_event_id = ?
        LIMIT 1
      `).get(row.source_world_event_id, row.source_world_event_id)
    : null;
  if (
    judgement &&
    Number(judgement.world_state_after_version) >
      Number(judgement.world_state_before_version)
  ) {
    for (const petId of activeMembers(db, worldId)) {
      recipients.push(descriptor(petId, {
        relevance: "contextual",
        relevanceReason: "shared_world_state_changed",
        deliveryPolicy: "digest",
        contentScope: "state_change_only",
      }));
    }
  }
  for (const petId of sceneParticipants(db, worldId, sceneId)) {
    recipients.push(descriptor(petId, {
      relevance: "contextual",
      relevanceReason: "scene_participant_update",
      deliveryPolicy: "ambient",
    }));
  }
  if (
    input?.event_type === "speech.directed" &&
    targetId &&
    targetId !== inputActorId
  ) {
    recipients.push(descriptor(targetId, {
      relevance: "direct",
      relevanceReason: "directed_speech_target",
      deliveryPolicy: "action_required",
      actionRequired: true,
    }));
  }
  return uniqueDescriptors(recipients);
}

export function snapshotWorldDeliveryRecipients(db, outboxId, {
  force = false,
} = {}) {
  const row = db.prepare(`
    SELECT * FROM world_delivery_outbox WHERE id = ?
  `).get(outboxId);
  if (!row) return [];
  if (!force && row.recipient_snapshot_json !== null) {
    return parseArray(row.recipient_snapshot_json);
  }
  const recipients = resolveWorldDeliveryRecipients(db, row);
  db.prepare(`
    UPDATE world_delivery_outbox
    SET recipient_snapshot_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(recipients),
    new Date().toISOString(),
    row.id,
  );
  return recipients;
}

export function refreshWorldDeliveryRecipientSnapshot(
  db,
  sourceWorldEventId,
) {
  const rows = db.prepare(`
    SELECT id FROM world_delivery_outbox
    WHERE source_world_event_id = ? AND status = 'pending'
  `).all(sourceWorldEventId);
  return rows.flatMap((row) =>
    snapshotWorldDeliveryRecipients(db, row.id, { force: true })
  );
}

function eventView(row) {
  return {
    id: Number(row.id),
    petId: row.pet_id,
    type: row.event_type,
    payload: parseObject(row.payload_json),
    createdAt: row.created_at,
  };
}

export function drainWorldDeliveryOutbox(db, {
  worldId = null,
  limit = 100,
  now = () => Date.now(),
  decorateEnvelope = (_worldId, envelope) => envelope,
  beforePersist,
  maxAttempts = 5,
  retryBaseDelayMs = 1_000,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  const boundedMaxAttempts = Math.max(1, Math.min(Number(maxAttempts) || 5, 100));
  const boundedRetryBaseDelayMs = Math.max(
    0,
    Math.min(Number(retryBaseDelayMs) || 0, 60 * 60 * 1000),
  );
  const drainNow = Number(now());
  const drainNowIso = new Date(drainNow).toISOString();
  const rows = db.prepare(`
    SELECT * FROM world_delivery_outbox
    WHERE status = 'pending'
      AND dead_letter_at IS NULL
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (? IS NULL OR space_id = ?)
    ORDER BY id ASC LIMIT ?
  `).all(drainNowIso, worldId, worldId, boundedLimit);
  const emitted = [];
  const failures = [];
  const deadLettered = [];

  for (const candidate of rows) {
    try {
      db.exec("BEGIN IMMEDIATE");
      const rowEmitted = [];
      const row = db.prepare(`
        SELECT * FROM world_delivery_outbox WHERE id = ? AND status = 'pending'
      `).get(candidate.id);
      if (!row) {
        db.exec("COMMIT");
        continue;
      }
      const envelope = parseObject(row.envelope_json);
      const recipients = snapshotWorldDeliveryRecipients(db, row.id);
      beforePersist?.({ row, envelope, recipients });
      const durablePayload = decorateEnvelope(row.space_id, envelope);
      const authoritativeStateChange = db.prepare(`
        SELECT world_state_after_version
        FROM world_judgements WHERE outcome_event_id = ?
        UNION ALL
        SELECT world_state_after_version
        FROM world_interaction_resolutions WHERE outcome_event_id = ?
        LIMIT 1
      `).get(row.source_world_event_id, row.source_world_event_id);
      const createdAt = now();
      for (const recipient of recipients) {
        const recipientDedupeKey = `${row.dedupe_key}:recipient:${recipient.petId}`;
        const recipientPayload = recipient.contentScope === "state_change_only"
          ? {
              worldName: durablePayload.worldName ?? row.space_id,
              outcomeEventType: "world.shared_state_changed",
              outcomeText: "共享世界状态已发生变化。",
              sharedWorldStateChanged: true,
              worldStateVersion:
                authoritativeStateChange?.world_state_after_version ?? null,
            }
          : durablePayload;
        const inserted = db.prepare(`
          INSERT OR IGNORE INTO events (
            pet_id, event_type, payload_json, created_at, semantic_dedupe_key
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          recipient.petId,
          row.event_type,
          JSON.stringify({
            worldId: row.space_id,
            ...recipientPayload,
            ...Object.fromEntries(
              Object.entries(recipient).filter(
                ([key]) => !["petId", "contentScope"].includes(key),
              ),
            ),
            dedupeKey: recipient.contentScope === "state_change_only"
              ? `world:${row.space_id}:shared-state:${authoritativeStateChange?.world_state_after_version ?? "changed"}:recipient:${recipient.petId}`
              : recipientDedupeKey,
          }),
          createdAt,
          recipientDedupeKey,
        );
        if (inserted.changes === 1) {
          const event = db.prepare(`
            SELECT * FROM events
            WHERE pet_id = ? AND semantic_dedupe_key = ?
          `).get(recipient.petId, recipientDedupeKey);
          if (event) rowEmitted.push(eventView(event));
        }
      }
      const timestamp = new Date(now()).toISOString();
      db.prepare(`
        UPDATE world_delivery_outbox
        SET status = 'delivered', attempt_count = attempt_count + 1,
          last_error = NULL, next_attempt_at = NULL, dead_letter_at = NULL,
          delivered_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(timestamp, timestamp, row.id);
      db.exec("COMMIT");
      emitted.push(...rowEmitted);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      const timestamp = new Date(now()).toISOString();
      const nextAttemptCount = Number(candidate.attempt_count ?? 0) + 1;
      const terminal = nextAttemptCount >= boundedMaxAttempts;
      const retryDelayMs = Math.min(
        60 * 60 * 1000,
        boundedRetryBaseDelayMs * (2 ** Math.max(0, nextAttemptCount - 1)),
      );
      const nextAttemptAt = terminal
        ? null
        : new Date(Number(now()) + retryDelayMs).toISOString();
      db.prepare(`
        UPDATE world_delivery_outbox
        SET attempt_count = attempt_count + 1, last_error = ?,
          next_attempt_at = ?, dead_letter_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(
        String(error?.message ?? error).slice(0, 2000),
        nextAttemptAt,
        terminal ? timestamp : null,
        timestamp,
        candidate.id,
      );
      const failure = {
        outboxId: candidate.id,
        error,
        attempt: nextAttemptCount,
        terminal,
        nextAttemptAt,
      };
      failures.push(failure);
      if (terminal) deadLettered.push(failure);
    }
  }
  return {
    emitted,
    failures,
    dead_lettered: deadLettered,
    processed: rows.length,
  };
}

export function retryDeadLetterWorldDelivery(
  db,
  outboxId,
  { timestamp = new Date().toISOString() } = {},
) {
  const updated = db.prepare(`
    UPDATE world_delivery_outbox
    SET attempt_count = 0, next_attempt_at = NULL, dead_letter_at = NULL,
      updated_at = ?
    WHERE id = ? AND status = 'pending' AND dead_letter_at IS NOT NULL
  `).run(timestamp, outboxId);
  return updated.changes === 1;
}

export function worldDeliveryOutboxStatus(db, { now = Date.now() } = {}) {
  const nowIso = new Date(Number(now)).toISOString();
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' AND dead_letter_at IS NULL THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'pending' AND dead_letter_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?) THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN status = 'pending' AND dead_letter_at IS NULL
        AND next_attempt_at > ? THEN 1 ELSE 0 END) AS scheduled,
      SUM(CASE WHEN status = 'pending' AND dead_letter_at IS NOT NULL THEN 1 ELSE 0 END) AS dead_letter,
      MIN(CASE WHEN status = 'pending' AND dead_letter_at IS NULL THEN created_at END) AS oldest_pending_at
    FROM world_delivery_outbox
  `).get(nowIso, nowIso);
  return {
    pending: Number(row.pending ?? 0),
    due: Number(row.due ?? 0),
    scheduled: Number(row.scheduled ?? 0),
    dead_letter: Number(row.dead_letter ?? 0),
    oldest_pending_at: row.oldest_pending_at ?? null,
  };
}
