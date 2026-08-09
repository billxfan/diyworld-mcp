import http from "node:http";
import { addCharacterAliases } from "./character-aliases.mjs";
import { AppError, invariant } from "./errors.mjs";
import {
  bearerToken,
  readJson,
  requestClientAddress,
  routeMatch,
  sendJson as sendHttpJson,
} from "./http.mjs";
import { CLIENT_PACKAGE_VERSION, clientReleaseMetadata } from "./release.mjs";
import { PetSocialStore } from "./store.mjs";
import { clampInteger, DAY_MS } from "./utils.mjs";
import { SocialError } from "./venue-lab-core/errors.js";
import { SocialService } from "./venue-lab-core/social-service.js";
import { LocalCodexWorldHostRunner } from "./world-host-runner.mjs";
import { handleRemoteMcpMessage } from "./remote-mcp.mjs";

const WORLD_NOT_FOUND_CODES = new Set(["NOT_FOUND"]);
const WORLD_FORBIDDEN_CODES = new Set([
  "FORBIDDEN",
  "ACTIVE_MEMBERSHIP_REQUIRED",
  "INVITATION_REQUIRED",
  "SHARE_REQUIRED",
  "SAME_SPACE_PRESENCE_REQUIRED",
  "WORLD_AGENT_PAUSED",
  "WORLD_HOST_CLAIM_REQUIRED"
]);
const WORLD_CONFLICT_CODES = new Set([
  "ALREADY_EXISTS",
  "IMMUTABLE_RULES",
  "RULE_VERSION_MISMATCH",
  "SPEC_VERSION_MISMATCH",
  "PROFILE_VERSION_MISMATCH",
  "WORLD_BUILD_VERSION_MISMATCH",
  "WORLD_BUILD_CLOSED",
  "WORLD_HOST_VERSION_MISMATCH",
  "WORLD_HOST_ALREADY_CLAIMED",
  "WORLD_HOST_SESSION_MISMATCH",
  "WORLD_HOST_UNAVAILABLE",
  "WORLD_NOT_ENTERED",
  "WORLD_NOT_PUBLISHED",
  "WORLD_MUST_BE_CLOSED",
  "WORLD_INTERACTION_ALREADY_RESPONDED",
  "WORLD_INTERACTION_BATCH_REQUIRED",
  "WORLD_INTERACTION_CLOSED",
  "WORLD_INTERACTION_NOT_READY",
  "STATE_VERSION_MISMATCH",
  "TRIGGER_ALREADY_FIRED"
]);

function sendJson(res, status, body) {
  return sendHttpJson(res, status, addCharacterAliases(body));
}

function requiredAgentScope(method, pathname) {
  if (
    pathname === "/v1/account" ||
    pathname === "/v1/account/deletion-request"
  ) {
    return "character:write";
  }
  if (
    pathname === "/v1/me" ||
    pathname === "/v1/profile" ||
    pathname === "/v1/character" ||
    pathname === "/v1/agent-binding" ||
    pathname === "/v1/agent-bindings" ||
    pathname.startsWith("/v1/agent-bindings/")
  ) {
    return method === "GET" ? "character:read" : "character:write";
  }
  if (pathname === "/v1/pet") {
    return method === "GET" ? "character:read" : "character:write";
  }
  if (pathname.startsWith("/v1/world-build")) return "world:create";
  if (pathname === "/v1/worlds") {
    return method === "GET" ? "world:discover" : "world:create";
  }
  if (pathname === "/v1/worlds/mine") return "world:create";
  if (pathname.startsWith("/v1/world-shares/")) return "world:discover";
  if (pathname === "/v1/world-invitations") return "world:participate";
  if (pathname.startsWith("/v1/worlds/")) {
    const managerOperation =
      pathname.includes("/host") ||
      pathname.includes("/admins") ||
      pathname.includes("/shares") ||
      pathname.includes("/invitations") ||
      pathname.includes("/join-requests") ||
      pathname.includes("/triggers") ||
      pathname.includes("/publish") ||
      pathname.includes("/close") ||
      pathname.includes("/resolve");
    if (managerOperation || method === "PATCH" || method === "DELETE") {
      return "world:admin";
    }
    const baseWorldPath = /^\/v1\/worlds\/[^/]+$/.test(pathname);
    return baseWorldPath && method === "GET"
      ? "world:discover"
      : "world:participate";
  }
  if (
    pathname === "/v1/square" ||
    pathname === "/v1/characters" ||
    pathname === "/v1/people" ||
    pathname === "/v1/friend-requests" ||
    pathname === "/v1/friends" ||
    pathname === "/v1/inbox" ||
    pathname === "/v1/activity" ||
    pathname === "/v1/events"
  ) {
    return method === "GET" ? "social:read" : "social:write";
  }
  if (
    pathname.startsWith("/v1/friend-requests/") ||
    pathname.startsWith("/v1/friends/") ||
    pathname === "/v1/blocks" ||
    pathname === "/v1/character-blocks" ||
    pathname === "/v1/messages" ||
    pathname.startsWith("/v1/conversations/") ||
    pathname.startsWith("/v1/events/")
  ) {
    return "social:write";
  }
  return null;
}

function requireAgentScope(auth, requiredScope) {
  if (!requiredScope) return;
  invariant(
    Array.isArray(auth.scopes) && auth.scopes.includes(requiredScope),
    403,
    "INSUFFICIENT_AGENT_SCOPE",
    `This Agent binding does not grant ${requiredScope}.`,
    { requiredScope, grantedScopes: Array.isArray(auth.scopes) ? auth.scopes : [] }
  );
}

function asWorldAppError(error) {
  if (!(error instanceof SocialError)) return error;
  const status = WORLD_NOT_FOUND_CODES.has(error.code)
    ? 404
    : WORLD_FORBIDDEN_CODES.has(error.code)
      ? 403
      : WORLD_CONFLICT_CODES.has(error.code)
        ? 409
        : 400;
  return new AppError(status, error.code, error.message, error.details);
}

function publicMessage(message) {
  return {
    id: message.id,
    conversationId: message.conversation_id,
    senderPetId: message.sender_pet_id,
    recipientPetId: message.recipient_pet_id,
    sequenceNo: message.sequence_no,
    text: message.content_text,
    status: message.status,
    createdAt: message.created_at,
    deliveredAt: message.delivered_at,
    readAt: message.read_at
  };
}

function publicFriendship(friendship) {
  return {
    id: friendship.id,
    requesterPetId: friendship.requester_pet_id,
    addresseePetId: friendship.addressee_pet_id,
    status: friendship.status,
    expiresAt: friendship.expires_at,
    acceptedAt: friendship.accepted_at,
    updatedAt: friendship.updated_at,
    version: friendship.version
  };
}

function eventEnvelope(event) {
  return {
    eventId: `evt_${event.id}`,
    sequence: event.id,
    eventType: event.type,
    occurredAt: event.createdAt,
    payload: event.payload,
    delivery: event.delivery ?? { state: "queued" }
  };
}

export function createPetSocialApp(options = {}) {
  const store = options.store ?? new PetSocialStore(options.databaseFile ?? ":memory:", { now: options.now });
  const presenceTtlMs = options.presenceTtlMs ?? 75_000;
  const recentWindowMs = options.recentWindowMs ?? 7 * DAY_MS;
  const inviteRequired = options.inviteRequired ?? false;
  const officialHostOwnerIds = new Set(options.officialHostOwnerIds ?? []);
  const clock = options.now ?? (() => Date.now());
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const cancelTimeout = options.clearTimeout ?? clearTimeout;
  const worldHostMode =
    options.worldHostMode === "local_codex" ? "local_codex" : "deterministic";
  const sseByPet = new Map();
  const rateBuckets = new Map();
  const interactionTimers = new Map();
  let selfUrl = options.mcpSelfUrl ?? null;
  const release = clientReleaseMetadata(options.clientRelease);

  function rateLimit(key, maximum, windowMs) {
    const now = clock();
    if (rateBuckets.size >= 10_000) {
      for (const [bucketKey, bucket] of rateBuckets) {
        if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
      }
    }
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= maximum) {
      throw new AppError(429, "RATE_LIMITED", "Too many requests.", { retryAfterMs: current.resetAt - now });
    }
    current.count += 1;
  }

  function addSseConnection(auth, res) {
    let devices = sseByPet.get(auth.pet_id);
    if (!devices) {
      devices = new Map();
      sseByPet.set(auth.pet_id, devices);
    }
    const previous = devices.get(auth.device_id);
    if (previous && previous !== res) previous.end();
    devices.set(auth.device_id, res);
  }

  function removeSseConnection(auth, res) {
    const devices = sseByPet.get(auth.pet_id);
    if (!devices) return;
    if (devices.get(auth.device_id) === res) devices.delete(auth.device_id);
    if (devices.size === 0) sseByPet.delete(auth.pet_id);
  }

  function disconnectPet(petId) {
    const devices = sseByPet.get(petId);
    if (!devices) return;
    for (const res of devices.values()) res.end();
    sseByPet.delete(petId);
  }

  function isReachable(pet) {
    const connections = sseByPet.get(pet.id);
    if (!connections?.size) return false;
    const devices = store.getDevicesForOwner(pet.owner_id);
    return devices.some((device) =>
      connections.has(device.id) &&
      device.codex_open === 1 &&
      device.last_heartbeat_at != null &&
      clock() - device.last_heartbeat_at <= presenceTtlMs
    );
  }

  function pushEvent(event) {
    const connections = sseByPet.get(event.petId);
    if (!connections?.size) return;
    const line = `id: ${event.id}\nevent: pet-social\ndata: ${JSON.stringify(eventEnvelope(event))}\n\n`;
    for (const res of connections.values()) {
      if (!res.destroyed) res.write(line);
    }
  }

  function pushEvents(events = []) {
    for (const event of events) pushEvent(event);
  }

  function worldNotificationRecipients(
    worldId,
    visibility = "world",
    actorPetId = null
  ) {
    if (visibility === "actor") return actorPetId ? [actorPetId] : [];
    if (visibility === "managers") {
      return store.db
        .prepare(`
          SELECT owner_pet_id AS pet_id FROM spaces
          WHERE id = ? AND owner_pet_id IS NOT NULL
          UNION
          SELECT pet_id FROM space_stewards WHERE space_id = ?
        `)
        .all(worldId, worldId)
        .map((row) => row.pet_id);
    }
    return store.db
      .prepare(`
        SELECT pet_id FROM space_memberships
        WHERE space_id = ? AND status = 'active'
      `)
      .all(worldId)
      .map((row) => row.pet_id);
  }

  function worldNotificationPayload(worldId, payload = {}) {
    const world = store.db
      .prepare("SELECT name FROM spaces WHERE id = ?")
      .get(worldId);
    const input = payload.inputId
      ? store.db
          .prepare(`
            SELECT input.*, actor.display_name AS actor_name
            FROM world_inputs input
            LEFT JOIN pets actor ON actor.id = input.actor_pet_id
            WHERE input.id = ? AND input.space_id = ?
          `)
          .get(payload.inputId, worldId)
      : null;
    const outcome = payload.outcomeEventId
      ? store.db
          .prepare(`
            SELECT body_text, event_type FROM world_events
            WHERE id = ? AND space_id = ?
          `)
          .get(payload.outcomeEventId, worldId)
      : null;
    const interaction = payload.interactionId
      ? store.db
          .prepare(`
            SELECT interaction.mode, interaction.quorum,
              interaction.late_input_policy, interaction.closes_at,
              prompt.body_text AS prompt_text
            FROM world_interactions interaction
            JOIN world_events prompt ON prompt.id = interaction.prompt_event_id
            WHERE interaction.id = ? AND interaction.space_id = ?
          `)
          .get(payload.interactionId, worldId)
      : null;
    let inputData = {};
    try {
      inputData = input ? JSON.parse(input.data_json ?? "{}")?.data ?? {} : {};
    } catch {
      inputData = {};
    }
    const targetCharacterId =
      inputData.target_character_id ?? inputData.target_pet_id ?? null;
    return {
      ...payload,
      worldName: world?.name ?? worldId,
      actorCharacterId: input?.actor_pet_id ?? null,
      actorName: input?.actor_name ?? null,
      inputType: input?.input_type ?? null,
      inputEventType: input?.event_type ?? null,
      inputBodyText: input?.body_text ?? null,
      targetCharacterId,
      outcomeText: outcome?.body_text ?? payload.outcomeText ?? null,
      outcomeEventType: outcome?.event_type ?? null,
      promptText: interaction?.prompt_text ?? payload.promptText ?? null,
      interactionMode: interaction?.mode ?? null,
      interactionQuorum: interaction?.quorum ?? null,
      interactionLateInputPolicy: interaction?.late_input_policy ?? null,
      interactionClosesAt: interaction?.closes_at ?? payload.closesAt ?? null,
    };
  }

  function notifyWorld(
    worldId,
    eventType,
    payload,
    { visibility = "world", actorPetId = null, recipients } = {}
  ) {
    const petIds =
      recipients ??
      worldNotificationRecipients(worldId, visibility, actorPetId);
    const durablePayload = eventType.startsWith("world.")
      ? worldNotificationPayload(worldId, payload)
      : payload;
    const emitted = [...new Set(petIds)].map((petId) =>
      store.createEvent(petId, eventType, { worldId, ...durablePayload })
    );
    pushEvents(emitted);
    return emitted;
  }

  function cancelInteractionDeadline(interactionId) {
    const timer = interactionTimers.get(interactionId);
    if (timer) cancelTimeout(timer);
    interactionTimers.delete(interactionId);
  }

  function makeInteractionReadyAtDeadline(interactionId) {
    cancelInteractionDeadline(interactionId);
    const timestamp = new Date().toISOString();
    const interaction = store.db
      .prepare(`
        SELECT * FROM world_interactions WHERE id = ?
      `)
      .get(interactionId);
    if (!interaction || interaction.status !== "open") return;
    if (Date.parse(interaction.closes_at) > Date.now()) {
      scheduleInteractionDeadline(interaction);
      return;
    }
    const updated = store.db
      .prepare(`
        UPDATE world_interactions
        SET status = 'ready', ready_at = COALESCE(ready_at, ?)
        WHERE id = ? AND status = 'open'
      `)
      .run(timestamp, interaction.id);
    if (updated.changes !== 1) return;
    const runtime = store.db
      .prepare(`
        SELECT claimed_by_pet_id FROM world_host_runtimes
        WHERE space_id = ? AND active_executor = 'creator_codex'
      `)
      .get(interaction.space_id);
    notifyWorld(
      interaction.space_id,
      "world.interaction_ready",
      {
        interactionId: interaction.id,
        reason: "deadline",
        closesAt: interaction.closes_at
      },
      runtime?.claimed_by_pet_id
        ? { recipients: [runtime.claimed_by_pet_id] }
        : { visibility: "managers" }
    );
    if (!runtime?.claimed_by_pet_id) {
      worldHostRunner?.enqueue(interaction.space_id);
    }
  }

  function scheduleInteractionDeadline(interaction) {
    cancelInteractionDeadline(interaction.id);
    const delay = Math.max(0, Date.parse(interaction.closes_at) - Date.now());
    const timer = scheduleTimeout(
      () => makeInteractionReadyAtDeadline(interaction.id),
      delay
    );
    timer.unref?.();
    interactionTimers.set(interaction.id, timer);
  }

  for (const interaction of store.db
    .prepare(`
      SELECT * FROM world_interactions WHERE status = 'open'
    `)
    .all()) {
    scheduleInteractionDeadline(interaction);
  }

  function authenticate(req) {
    return store.authenticate(bearerToken(req));
  }

  function worldService(auth) {
    return new SocialService(store.db, auth.character_id, {
      identitySchema: "shared",
      principalUserId: auth.owner_id,
      principalSessionId: auth.device_id,
      officialHostPrincipalUserIds: officialHostOwnerIds,
      platformHostMode: worldHostMode
    });
  }

  const worldHostRunner =
    options.worldHostRunner ??
    (worldHostMode === "local_codex"
      ? new LocalCodexWorldHostRunner({
          db: store.db,
          codexClient: options.worldHostCodexClient,
          maxConcurrency: options.worldHostMaxConcurrency ?? 2,
          hostRoot: options.worldHostRoot,
          model: options.worldHostModel,
          effort: options.worldHostEffort,
          threadIsolation: options.worldHostThreadIsolation ?? "per_turn",
          onCommitted(result) {
            if (result.interaction) {
              cancelInteractionDeadline(result.interaction.id);
              notifyWorld(
                result.world_id,
                "world.event_committed",
                {
                  interactionId: result.interaction.id,
                  inputIds: result.inputs.map((input) => input.input.id),
                  outcomeEventId: result.outcome?.id ?? null,
                  outcomeSequence: result.outcome?.sequence ?? null,
                },
              );
              return;
            }
            notifyWorld(
              result.world_id,
              "world.event_committed",
              {
                inputId: result.input.id,
                outcomeEventId: result.outcome?.id ?? null,
                outcomeSequence: result.outcome?.sequence ?? null
              },
              {
                visibility: result.input.visibility,
                actorPetId: result.input.actor_pet_id
              }
            );
          },
          onError(error, context) {
            options.onError?.(Object.assign(error, { worldHost: context }));
          }
        })
      : null);
  const worldHostPrewarm = worldHostRunner?.start({
    prewarmPublishedWorlds: options.worldHostPrewarm === true,
  }) ?? Promise.resolve({ bound_world_ids: [], failed_world_ids: [] });
  const worldHostActionWaitMs = Math.max(
    1_000,
    Math.min(Number(options.worldHostActionWaitMs) || 45_000, 120_000),
  );

  async function handler(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      const { pathname } = url;
      const clientAddress = requestClientAddress(req, {
        trustCloudflareProxy: options.trustCloudflareProxy === true,
      });

      if (req.method === "GET" && pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "diyworld",
          product: "agent-world-social",
          registrationMode: inviteRequired ? "invite_only" : "open",
          mcp: {
            transport: "streamable-http",
            endpoint: "/mcp",
            ready: Boolean(selfUrl),
            version: CLIENT_PACKAGE_VERSION,
          },
          versions: release,
          now: clock()
        });
      }

      if (pathname === "/mcp") {
        invariant(req.method === "POST", 405, "METHOD_NOT_ALLOWED", "MCP endpoint accepts POST requests only.");
        const origin = req.headers.origin;
        const allowedOrigins = options.mcpAllowedOrigins ?? [];
        invariant(
          !origin || allowedOrigins.includes(origin),
          403,
          "MCP_ORIGIN_FORBIDDEN",
          "This browser origin is not allowed to access the MCP endpoint."
        );
        const token = bearerToken(req);
        invariant(token, 401, "MCP_AUTH_REQUIRED", "Provide an Agent credential as a Bearer token.");
        const auth = authenticate(req);
        rateLimit(`mcp:${auth.device_id}`, 240, 60 * 1000);
        invariant(selfUrl, 503, "MCP_NOT_READY", "MCP endpoint is not ready yet.");
        const message = await readJson(req);
        const response = await handleRemoteMcpMessage({ message, serverUrl: selfUrl, token });
        if (!response) return sendJson(res, 202, {});
        return sendJson(res, 200, response);
      }

      if (req.method === "POST" && pathname === "/v1/register") {
        rateLimit(`account-register:${clientAddress}`, 20, 60 * 60 * 1000);
        const body = await readJson(req);
        const registration = store.register(body, {
          inviteRequired,
          registrationLimit: options.registrationLimit ?? 1_000,
          referralInviteGrantLimit:
            options.referralInviteGrantLimit ?? 500,
        });
        return sendJson(res, 201, registration);
      }

      if (req.method === "POST" && pathname === "/v1/recover") {
        rateLimit(`account-recovery:${clientAddress}`, 10, 60 * 60 * 1000);
        const body = await readJson(req);
        return sendJson(res, 201, store.recoverAccount(body));
      }

      const auth = authenticate(req);
      requireAgentScope(auth, requiredAgentScope(req.method, pathname));

      if (req.method === "POST" && pathname === "/v1/account/deletion-request") {
        rateLimit(`account-deletion:${auth.owner_id}`, 5, 60 * 60 * 1000);
        return sendJson(res, 200, store.requestAccountDeletion(auth));
      }

      if (req.method === "DELETE" && pathname === "/v1/account") {
        rateLimit(`account-delete:${auth.owner_id}`, 5, 60 * 60 * 1000);
        const body = await readJson(req);
        const result = store.deleteAccount(auth, body);
        pushEvents(result.events);
        disconnectPet(result.petId);
        return sendJson(res, 200, {
          deleted: result.deleted,
          deletedAt: result.deletedAt,
          historyRetainedForContacts: result.historyRetainedForContacts
        });
      }

      if (req.method === "GET" && pathname === "/v1/me") {
        const pet = store.getPet(auth.pet_id);
        return sendJson(res, 200, {
          ownerId: auth.owner_id,
          deviceId: auth.device_id,
          pet: { id: pet.id, name: pet.display_name, handle: `@${pet.handle}`, bio: pet.bio, visibility: pet.visibility },
          character: store.getCharacter(auth.character_id),
          profile: store.getProfile(auth.character_id),
          agentBinding: store.getAgentBinding(auth)
        });
      }

      if (req.method === "GET" && pathname === "/v1/character") {
        return sendJson(res, 200, {
          ownerId: auth.owner_id,
          character: store.getCharacter(auth.character_id)
        });
      }

      if (req.method === "GET" && pathname === "/v1/profile") {
        return sendJson(res, 200, {
          ownerId: auth.owner_id,
          profile: store.getProfile(auth.character_id),
        });
      }

      if (req.method === "PATCH" && pathname === "/v1/profile") {
        const body = await readJson(req);
        return sendJson(res, 200, {
          profile: store.updateProfile(auth, body),
        });
      }

      if (req.method === "PATCH" && pathname === "/v1/character") {
        const body = await readJson(req);
        return sendJson(res, 200, {
          character: store.updateCharacter(auth, body)
        });
      }

      if (req.method === "GET" && pathname === "/v1/agent-binding") {
        return sendJson(res, 200, {
          agentBinding: store.getAgentBinding(auth)
        });
      }

      if (req.method === "GET" && pathname === "/v1/agent-bindings") {
        return sendJson(res, 200, {
          agentBindings: store.listAgentBindings(auth)
        });
      }

      const agentBindingParams = routeMatch(pathname, "/v1/agent-bindings/:id");
      if (req.method === "DELETE" && agentBindingParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          store.revokeAgentBinding(auth, agentBindingParams.id, body)
        );
      }

      if (req.method === "PATCH" && pathname === "/v1/pet") {
        const body = await readJson(req);
        const pet = store.updatePet(auth, body);
        return sendJson(res, 200, {
          pet: { id: pet.id, name: pet.display_name, handle: `@${pet.handle}`, bio: pet.bio, visibility: pet.visibility }
        });
      }

      if (req.method === "POST" && pathname === "/v1/heartbeat") {
        const body = await readJson(req);
        invariant(typeof body.codexOpen === "boolean", 400, "INVALID_HEARTBEAT", "codexOpen must be a boolean.");
        const result = store.heartbeat(auth, body);
        worldService(auth).heartbeatWorldPresence({
          codexOpen: body.codexOpen
        });
        return sendJson(res, 200, result);
      }

      if (req.method === "POST" && pathname === "/v1/agent/heartbeat") {
        const body = await readJson(req);
        invariant(typeof body.active === "boolean", 400, "INVALID_HEARTBEAT", "active must be a boolean.");
        const result = store.agentHeartbeat(auth, {
          active: body.active,
          clientVersion: body.clientVersion ?? "agent"
        });
        worldService(auth).heartbeatWorldPresence({ codexOpen: body.active });
        return sendJson(res, 200, {
          receivedAt: result.receivedAt,
          active: result.active
        });
      }

      if (req.method === "GET" && pathname === "/v1/worlds") {
        const query = url.searchParams.get("query") ?? "";
        const limit = clampInteger(url.searchParams.get("limit"), 1, 50, 20);
        return sendJson(res, 200, worldService(auth).searchWorlds({ query, limit }));
      }

      if (req.method === "GET" && pathname === "/v1/world-builder/templates") {
        return sendJson(
          res,
          200,
          worldService(auth).listWorldBuilderTemplates()
        );
      }

      if (req.method === "POST" && pathname === "/v1/world-builds") {
        rateLimit(`world-build:${auth.pet_id}`, 30, 60 * 60 * 1000);
        const body = await readJson(req);
        return sendJson(res, 201, worldService(auth).startWorldBuild(body));
      }

      const worldRefinementParams = routeMatch(
        pathname,
        "/v1/worlds/:id/refinement"
      );
      if (req.method === "GET" && worldRefinementParams) {
        return sendJson(
          res,
          200,
          worldService(auth).worldRefinementReport({
            worldId: worldRefinementParams.id
          })
        );
      }

      const worldBuildMaterializeParams = routeMatch(
        pathname,
        "/v1/world-builds/:id/materialize"
      );
      if (req.method === "POST" && worldBuildMaterializeParams) {
        rateLimit(`world-create:${auth.pet_id}`, 10, 60 * 60 * 1000);
        const body = await readJson(req);
        return sendJson(
          res,
          201,
          worldService(auth).materializeWorldBuild({
            buildId: worldBuildMaterializeParams.id,
            ...body
          })
        );
      }

      const worldBuildParams = routeMatch(pathname, "/v1/world-builds/:id");
      if (req.method === "GET" && worldBuildParams) {
        return sendJson(
          res,
          200,
          worldService(auth).getWorldBuild({ buildId: worldBuildParams.id })
        );
      }
      if (req.method === "PATCH" && worldBuildParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).updateWorldBuild({
            buildId: worldBuildParams.id,
            ...body
          })
        );
      }

      if (req.method === "POST" && pathname === "/v1/worlds") {
        rateLimit(`world-create:${auth.pet_id}`, 10, 60 * 60 * 1000);
        const body = await readJson(req);
        return sendJson(res, 201, worldService(auth).createWorld(body));
      }

      if (req.method === "GET" && pathname === "/v1/worlds/mine") {
        return sendJson(res, 200, worldService(auth).listMyWorlds());
      }

      if (req.method === "GET" && pathname === "/v1/world-invitations") {
        return sendJson(res, 200, worldService(auth).listWorldInvitations());
      }

      const worldShareParams = routeMatch(pathname, "/v1/world-shares/:token");
      if (req.method === "GET" && worldShareParams) {
        return sendJson(
          res,
          200,
          worldService(auth).openWorldShare({ token: worldShareParams.token })
        );
      }

      const worldParams = routeMatch(pathname, "/v1/worlds/:id");
      if (req.method === "GET" && worldParams) {
        return sendJson(
          res,
          200,
          worldService(auth).getWorld({ worldId: worldParams.id })
        );
      }
      if (req.method === "PATCH" && worldParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).updateWorld({ ...body, worldId: worldParams.id })
        );
      }
      if (req.method === "DELETE" && worldParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).deleteWorld({
            worldId: worldParams.id,
            confirmed: body.confirmed
          })
        );
      }

      const worldPublishParams = routeMatch(pathname, "/v1/worlds/:id/publish");
      if (req.method === "POST" && worldPublishParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).publishWorld({
            ...body,
            worldId: worldPublishParams.id
          })
        );
      }

      const worldCloseParams = routeMatch(pathname, "/v1/worlds/:id/close");
      if (req.method === "POST" && worldCloseParams) {
        return sendJson(
          res,
          200,
          worldService(auth).closeWorld({ worldId: worldCloseParams.id })
        );
      }

      const worldHostParams = routeMatch(pathname, "/v1/worlds/:id/host");
      if (req.method === "GET" && worldHostParams) {
        return sendJson(
          res,
          200,
          worldService(auth).getWorldHost({ worldId: worldHostParams.id })
        );
      }
      if (req.method === "PATCH" && worldHostParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).updateWorldHost({
            ...body,
            worldId: worldHostParams.id
          })
        );
      }

      const worldRuntimeParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/runtime"
      );
      if (req.method === "GET" && worldRuntimeParams) {
        return sendJson(
          res,
          200,
          worldService(auth).getWorldHostRuntime({
            worldId: worldRuntimeParams.id
          })
        );
      }

      const worldHostTakeoverParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/takeover"
      );
      if (req.method === "POST" && worldHostTakeoverParams) {
        const body = await readJson(req);
        const result = worldService(auth).takeoverWorldHost({
          ...body,
          worldId: worldHostTakeoverParams.id
        });
        notifyWorld(worldHostTakeoverParams.id, "world.host_runtime_changed", {
          status: result.runtime.status,
          activeExecutor: result.runtime.active_executor
        });
        return sendJson(res, 200, result);
      }

      const worldHostHeartbeatParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/heartbeat"
      );
      if (req.method === "POST" && worldHostHeartbeatParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).heartbeatWorldHost({
            ...body,
            worldId: worldHostHeartbeatParams.id
          })
        );
      }

      const worldHostReleaseParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/release"
      );
      if (req.method === "POST" && worldHostReleaseParams) {
        const body = await readJson(req);
        const result = worldService(auth).releaseWorldHost({
          ...body,
          worldId: worldHostReleaseParams.id
        });
        notifyWorld(worldHostReleaseParams.id, "world.host_runtime_changed", {
          status: result.runtime.status,
          activeExecutor: result.runtime.active_executor
        });
        return sendJson(res, 200, result);
      }

      const worldHostNextInputParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/inputs/next"
      );
      if (req.method === "GET" && worldHostNextInputParams) {
        return sendJson(
          res,
          200,
          worldService(auth).nextWorldHostInput({
            worldId: worldHostNextInputParams.id,
            clientSessionId: url.searchParams.get("clientSessionId") ?? undefined
          })
        );
      }

      const worldHostResolveInputParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/inputs/:inputId/resolve"
      );
      if (req.method === "POST" && worldHostResolveInputParams) {
        const body = await readJson(req);
        const result = worldService(auth).resolveWorldHostInput({
          ...body,
          worldId: worldHostResolveInputParams.id,
          inputId: worldHostResolveInputParams.inputId
        });
        notifyWorld(
          worldHostResolveInputParams.id,
          "world.event_committed",
          {
            inputId: result.input.id,
            outcomeEventId: result.outcome?.id ?? null,
            outcomeSequence: result.outcome?.sequence ?? null
          },
          {
            visibility: result.input.visibility,
            actorPetId: result.input.actor_pet_id
          }
        );
        return sendJson(res, 200, result);
      }

      const worldHostInteractionOpenParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/interactions"
      );
      if (req.method === "POST" && worldHostInteractionOpenParams) {
        const body = await readJson(req);
        const result = worldService(auth).openWorldHostInteraction({
          ...body,
          worldId: worldHostInteractionOpenParams.id
        });
        notifyWorld(
          worldHostInteractionOpenParams.id,
          "world.interaction_opened",
          {
            interactionId: result.interaction.id,
            promptEventId: result.prompt_event.id,
            closesAt: result.interaction.closes_at
          }
        );
        scheduleInteractionDeadline(
          store.db
            .prepare("SELECT * FROM world_interactions WHERE id = ?")
            .get(result.interaction.id)
        );
        return sendJson(res, 201, result);
      }

      const worldHostInteractionResolveParams = routeMatch(
        pathname,
        "/v1/worlds/:id/host/interactions/:interactionId/resolve"
      );
      if (req.method === "POST" && worldHostInteractionResolveParams) {
        const body = await readJson(req);
        const result = worldService(auth).resolveWorldHostInteraction({
          ...body,
          worldId: worldHostInteractionResolveParams.id,
          interactionId: worldHostInteractionResolveParams.interactionId
        });
        notifyWorld(
          worldHostInteractionResolveParams.id,
          "world.event_committed",
          {
            interactionId: result.interaction.id,
            outcomeEventId: result.outcome.id,
            outcomeSequence: result.outcome.sequence
          }
        );
        cancelInteractionDeadline(result.interaction.id);
        return sendJson(res, 200, result);
      }

      const worldJoinParams = routeMatch(pathname, "/v1/worlds/:id/join");
      if (req.method === "POST" && worldJoinParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).joinWorld({
            ...body,
            worldId: worldJoinParams.id
          })
        );
      }

      const worldRulesParams = routeMatch(
        pathname,
        "/v1/worlds/:id/rules/accept"
      );
      if (req.method === "POST" && worldRulesParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).acceptWorldRules({
            ...body,
            worldId: worldRulesParams.id
          })
        );
      }

      const worldEnterParams = routeMatch(pathname, "/v1/worlds/:id/enter");
      if (req.method === "POST" && worldEnterParams) {
        const body = await readJson(req);
        const service = worldService(auth);
        const result = service.enterWorld({
          worldId: worldEnterParams.id,
          clientSessionId: body.clientSessionId
        });
        if (worldHostRunner) {
          try {
            await worldHostRunner.bindWorld({
              worldId: worldEnterParams.id,
              actorPetId: auth.character_id,
              principalUserId: auth.owner_id,
            });
            result.host_runtime = service.getWorldHostRuntime({
              worldId: worldEnterParams.id,
            }).runtime;
          } catch (error) {
            options.onError?.(Object.assign(error, {
              worldHost: { worldId: worldEnterParams.id, phase: "bind" },
            }));
          }
        }
        notifyWorld(worldEnterParams.id, "world.presence_changed", {
          petId: auth.pet_id,
          change: "entered",
          activeMemberCount: result.host_runtime.active_member_count,
          hostStatus: result.host_runtime.status
        });
        return sendJson(res, 200, result);
      }

      const worldLeaveParams = routeMatch(pathname, "/v1/worlds/:id/leave");
      if (req.method === "POST" && worldLeaveParams) {
        const result = worldService(auth).leaveWorld({
          worldId: worldLeaveParams.id
        });
        notifyWorld(worldLeaveParams.id, "world.presence_changed", {
          petId: auth.pet_id,
          change: "left",
          activeMemberCount: result.host_runtime?.active_member_count ?? 0,
          hostStatus: result.host_runtime?.status ?? "idle"
        });
        return sendJson(res, 200, result);
      }

      const worldPresentParams = routeMatch(
        pathname,
        "/v1/worlds/:id/present"
      );
      if (req.method === "GET" && worldPresentParams) {
        return sendJson(
          res,
          200,
          worldService(auth).listWorldPresent({
            worldId: worldPresentParams.id
          })
        );
      }

      const worldAdminsParams = routeMatch(pathname, "/v1/worlds/:id/admins");
      if (req.method === "POST" && worldAdminsParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          201,
          worldService(auth).addWorldAdmin({
            ...body,
            worldId: worldAdminsParams.id
          })
        );
      }
      const worldAdminParams = routeMatch(
        pathname,
        "/v1/worlds/:id/admins/:petId"
      );
      if (req.method === "DELETE" && worldAdminParams) {
        return sendJson(
          res,
          200,
          worldService(auth).removeWorldAdmin({
            worldId: worldAdminParams.id,
            targetPetId: worldAdminParams.petId
          })
        );
      }

      const worldSharesParams = routeMatch(pathname, "/v1/worlds/:id/shares");
      if (req.method === "POST" && worldSharesParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          201,
          worldService(auth).createWorldShare({
            ...body,
            worldId: worldSharesParams.id
          })
        );
      }

      const worldInvitesParams = routeMatch(
        pathname,
        "/v1/worlds/:id/invitations"
      );
      if (req.method === "POST" && worldInvitesParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          201,
          worldService(auth).createWorldInvitation({
            ...body,
            worldId: worldInvitesParams.id
          })
        );
      }

      const worldJoinRequestsParams = routeMatch(
        pathname,
        "/v1/worlds/:id/join-requests"
      );
      if (req.method === "GET" && worldJoinRequestsParams) {
        return sendJson(
          res,
          200,
          worldService(auth).listWorldJoinRequests({
            worldId: worldJoinRequestsParams.id
          })
        );
      }

      const worldJoinRespondParams = routeMatch(
        pathname,
        "/v1/worlds/:id/join-requests/:petId/respond"
      );
      if (req.method === "POST" && worldJoinRespondParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).respondWorldJoinRequest({
            ...body,
            worldId: worldJoinRespondParams.id,
            applicantPetId: worldJoinRespondParams.petId
          })
        );
      }

      const worldObserveParams = routeMatch(
        pathname,
        "/v1/worlds/:id/observe"
      );
      if (req.method === "GET" && worldObserveParams) {
        const afterSequence = url.searchParams.has("after")
          ? clampInteger(
              url.searchParams.get("after"),
              0,
              Number.MAX_SAFE_INTEGER,
              0
            )
          : undefined;
        const limit = clampInteger(url.searchParams.get("limit"), 1, 100, 50);
        return sendJson(
          res,
          200,
          worldService(auth).observeWorld({
            worldId: worldObserveParams.id,
            afterSequence,
            limit
          })
        );
      }

      const worldActParams = routeMatch(pathname, "/v1/worlds/:id/intents");
      const worldInputParams = routeMatch(pathname, "/v1/worlds/:id/inputs");
      const worldInputResultParams = routeMatch(
        pathname,
        "/v1/worlds/:id/inputs/:inputId/result"
      );
      if (req.method === "GET" && worldInputResultParams) {
        rateLimit(`world-result:${auth.pet_id}`, 180, 60 * 1000);
        const service = worldService(auth);
        let result = service.getWorldInputResult({
          worldId: worldInputResultParams.id,
          inputId: worldInputResultParams.inputId
        });
        if (
          result.processing.should_retry &&
          result.processing.state !== "collecting" &&
          result.processing.state !== "waiting_for_creator_host"
        ) {
          worldHostRunner?.enqueue(worldInputResultParams.id);
        }
        const waitMs = clampInteger(
          url.searchParams.get("wait_ms"),
          0,
          30_000,
          25_000
        );
        const waitUntil = Date.now() + waitMs;
        while (
          !result.processing.final &&
          result.processing.state !== "collecting" &&
          result.processing.state !== "waiting_for_creator_host" &&
          Date.now() < waitUntil
        ) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          result = service.getWorldInputResult({
            worldId: worldInputResultParams.id,
            inputId: worldInputResultParams.inputId
          });
        }
        return sendJson(res, 200, result);
      }
      const worldSubmitParams = worldInputParams ?? worldActParams;
      if (req.method === "POST" && worldSubmitParams) {
        rateLimit(`world-act:${auth.pet_id}`, 120, 60 * 1000);
        const body = await readJson(req);
        let result = worldService(auth).actInWorld({
          ...body,
          worldId: worldSubmitParams.id,
          requireLive: Boolean(worldInputParams)
        });
        if (result.status === "pending" || result.status === "ready_for_host") {
          const runtime = store.db
            .prepare(`
              SELECT claimed_by_pet_id FROM world_host_runtimes
              WHERE space_id = ? AND active_executor = 'creator_codex'
            `)
            .get(worldSubmitParams.id);
          if (runtime?.claimed_by_pet_id) {
            notifyWorld(
              worldSubmitParams.id,
              result.status === "ready_for_host"
                ? "world.interaction_ready"
                : "world.host_input_pending",
              {
                inputId: result.input.id,
                interactionId: result.input.interaction_id ?? null
              },
              { recipients: [runtime.claimed_by_pet_id] }
            );
          } else {
            worldHostRunner?.enqueue(worldSubmitParams.id);
            if (
              worldActParams &&
              result.status === "pending" &&
              !result.input.interaction_id &&
              worldHostRunner?.waitForInput
            ) {
              const committed = await worldHostRunner.waitForInput(
                result.input.id,
                { timeoutMs: worldHostActionWaitMs },
              );
              if (committed) {
                result = worldService(auth).worldIntentResult(result.input.id);
              }
            }
          }
          if (result.status === "ready_for_host" && result.input.interaction_id) {
            cancelInteractionDeadline(result.input.interaction_id);
          }
        } else if (result.outcome) {
          notifyWorld(
            worldSubmitParams.id,
            "world.event_committed",
            {
              inputId: result.input.id,
              outcomeEventId: result.outcome.id,
              outcomeSequence: result.outcome.sequence
            },
            {
              visibility: result.input.visibility,
              actorPetId: result.input.actor_pet_id
            }
          );
          if (result.input.event_type === "speech.directed") {
            result = worldService(auth).worldIntentResult(result.input.id);
          }
        }
        return sendJson(res, 201, result);
      }

      const worldResolveParams = routeMatch(
        pathname,
        "/v1/worlds/:id/intents/:intentId/resolve"
      );
      if (req.method === "POST" && worldResolveParams) {
        const body = await readJson(req);
        let result = worldService(auth).resolveWorldIntent({
          ...body,
          worldId: worldResolveParams.id,
          intentId: worldResolveParams.intentId
        });
        notifyWorld(
          worldResolveParams.id,
          "world.event_committed",
          {
            inputId: result.input.id,
            outcomeEventId: result.outcome?.id ?? null,
            outcomeSequence: result.outcome?.sequence ?? null
          },
          {
            visibility: result.input.visibility,
            actorPetId: result.input.actor_pet_id
          }
        );
        if (result.input.event_type === "speech.directed") {
          result = worldService(auth).worldIntentResult(result.input.id);
        }
        return sendJson(res, 200, result);
      }

      const worldAckParams = routeMatch(
        pathname,
        "/v1/worlds/:id/events/ack"
      );
      if (req.method === "POST" && worldAckParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).ackWorldEvents({
            ...body,
            worldId: worldAckParams.id
          })
        );
      }

      const worldDelegationParams = routeMatch(
        pathname,
        "/v1/worlds/:id/delegation"
      );
      if (req.method === "POST" && worldDelegationParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          200,
          worldService(auth).setWorldDelegation({
            ...body,
            worldId: worldDelegationParams.id
          })
        );
      }

      const worldTriggersParams = routeMatch(
        pathname,
        "/v1/worlds/:id/triggers"
      );
      if (req.method === "POST" && worldTriggersParams) {
        const body = await readJson(req);
        return sendJson(
          res,
          201,
          worldService(auth).createWorldTrigger({
            ...body,
            worldId: worldTriggersParams.id
          })
        );
      }
      if (req.method === "GET" && worldTriggersParams) {
        const status = url.searchParams.get("status") ?? undefined;
        return sendJson(
          res,
          200,
          worldService(auth).listWorldTriggers({
            worldId: worldTriggersParams.id,
            status
          })
        );
      }

      const worldTriggerCancelParams = routeMatch(
        pathname,
        "/v1/worlds/:id/triggers/:triggerId"
      );
      if (req.method === "DELETE" && worldTriggerCancelParams) {
        return sendJson(
          res,
          200,
          worldService(auth).cancelWorldTrigger({
            worldId: worldTriggerCancelParams.id,
            triggerId: worldTriggerCancelParams.triggerId
          })
        );
      }

      if (req.method === "GET" && pathname === "/v1/square") {
        const limit = clampInteger(url.searchParams.get("limit"), 1, 20, 20);
        const result = store.listSquare(auth, { recentWindowMs, isReachable, limit });
        return sendJson(res, 200, result);
      }

      if (req.method === "GET" && pathname === "/v1/characters") {
        const limit = clampInteger(url.searchParams.get("limit"), 1, 20, 20);
        const result = store.listCharacters(auth, { recentWindowMs, isReachable, limit });
        return sendJson(res, 200, result);
      }

      if (req.method === "GET" && pathname === "/v1/people") {
        const limit = clampInteger(url.searchParams.get("limit"), 1, 20, 20);
        return sendJson(
          res,
          200,
          store.listPeople(auth, { recentWindowMs, isReachable, limit }),
        );
      }

      if (req.method === "POST" && pathname === "/v1/friend-requests") {
        rateLimit(`friend:${auth.pet_id}`, 20, 60 * 60 * 1000);
        const body = await readJson(req);
        const target = store.resolveTarget(body.target);
        invariant(target, 404, "PET_NOT_FOUND", "Target Character was not found.");
        const result = store.sendFriendRequest(auth, { targetPetId: target.id, clientRequestId: body.clientRequestId });
        pushEvents(result.events);
        return sendJson(res, result.idempotent ? 200 : 201, {
          friendship: publicFriendship(result.friendship),
          autoAccepted: Boolean(result.autoAccepted),
          idempotent: Boolean(result.idempotent)
        });
      }

      if (req.method === "GET" && pathname === "/v1/friend-requests") {
        const direction = url.searchParams.get("direction") === "outgoing" ? "outgoing" : "incoming";
        return sendJson(res, 200, { requests: store.listFriendRequests(auth, direction) });
      }

      const respondParams = routeMatch(pathname, "/v1/friend-requests/:id/respond");
      if (req.method === "POST" && respondParams) {
        const body = await readJson(req);
        const result = store.respondFriendRequest(auth, respondParams.id, body.decision);
        pushEvents(result.events);
        return sendJson(res, 200, { friendship: publicFriendship(result.friendship) });
      }

      if (req.method === "GET" && pathname === "/v1/friends") {
        return sendJson(res, 200, { friends: store.listFriends(auth) });
      }

      const friendParams = routeMatch(pathname, "/v1/friends/:id");
      if (req.method === "DELETE" && friendParams) {
        const result = store.removeFriend(auth, friendParams.id);
        pushEvents(result.events);
        return sendJson(res, 200, { friendship: publicFriendship(result.friendship), historyRetained: true });
      }

      if (req.method === "POST" && pathname === "/v1/blocks") {
        const body = await readJson(req);
        const target = store.resolveTarget(body.target);
        invariant(target, 404, "PET_NOT_FOUND", "Target Character was not found.");
        const result = store.blockPet(auth, target.id);
        return sendJson(res, result.idempotent ? 200 : 201, {
          blocked: true,
          petId: target.id,
          friendshipId: result.friendship.id,
          idempotent: Boolean(result.idempotent),
          historyRetained: true
        });
      }

      if (req.method === "POST" && pathname === "/v1/character-blocks") {
        const body = await readJson(req);
        const target = store.resolveTarget(body.target);
        invariant(target, 404, "CHARACTER_NOT_FOUND", "Target character was not found.");
        const result = store.blockPet(auth, target.id);
        return sendJson(res, result.idempotent ? 200 : 201, {
          blocked: true,
          petId: target.id,
          characterId: target.id,
          friendshipId: result.friendship.id,
          idempotent: Boolean(result.idempotent),
          historyRetained: true
        });
      }

      if (req.method === "POST" && pathname === "/v1/messages") {
        rateLimit(`message:${auth.pet_id}`, 30, 60 * 1000);
        const body = await readJson(req);
        const result = store.sendMessage(auth, body);
        pushEvents(result.events);
        return sendJson(res, result.idempotent ? 200 : 201, { message: publicMessage(result.message), idempotent: Boolean(result.idempotent) });
      }

      if (req.method === "GET" && pathname === "/v1/inbox") {
        const limit = clampInteger(url.searchParams.get("limit"), 1, 100, 50);
        return sendJson(res, 200, { messages: store.listInbox(auth, { limit }) });
      }

      if (req.method === "GET" && pathname === "/v1/activity") {
        const limit = clampInteger(url.searchParams.get("limit"), 1, 100, 50);
        return sendJson(res, 200, {
          channels: ["private_message", "world"],
          items: store.listActivity(auth, { limit }),
        });
      }

      const readParams = routeMatch(pathname, "/v1/conversations/:id/read");
      if (req.method === "POST" && readParams) {
        const body = await readJson(req);
        const result = store.markRead(auth, readParams.id, body.maxSequenceNo);
        pushEvents(result.events);
        return sendJson(res, 200, { conversationId: result.conversationId, maxSequenceNo: result.maxSequenceNo });
      }

      if (req.method === "GET" && pathname === "/v1/events") {
        const after = clampInteger(url.searchParams.get("cursor") ?? req.headers["last-event-id"], 0, Number.MAX_SAFE_INTEGER, 0);
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no"
        });
        res.write(": connected\n\n");
        addSseConnection(auth, res);
        for (const event of store.listEvents(auth, after)) {
          res.write(`id: ${event.id}\nevent: pet-social\ndata: ${JSON.stringify(eventEnvelope(event))}\n\n`);
        }
        const keepAlive = setInterval(() => {
          if (!res.destroyed) res.write(`: keepalive ${clock()}\n\n`);
        }, 15_000);
        keepAlive.unref();
        req.on("close", () => {
          clearInterval(keepAlive);
          removeSseConnection(auth, res);
        });
        return;
      }

      const ackParams = routeMatch(pathname, "/v1/events/:id/ack");
      if (req.method === "POST" && ackParams) {
        const eventId = Number(String(ackParams.id).replace(/^evt_/, ""));
        invariant(Number.isSafeInteger(eventId), 400, "INVALID_EVENT_ID", "Invalid event ID.");
        const result = store.ackEvent(auth, eventId);
        pushEvents(result.events);
        return sendJson(res, 200, { acked: true });
      }

      const receiptParams = routeMatch(pathname, "/v1/events/:id/receipt");
      if (req.method === "POST" && receiptParams) {
        const eventId = Number(String(receiptParams.id).replace(/^evt_/, ""));
        invariant(Number.isSafeInteger(eventId), 400, "INVALID_EVENT_ID", "Invalid event ID.");
        const body = await readJson(req);
        const result = store.recordEventReceipt(auth, eventId, body.state);
        pushEvents(result.events);
        return sendJson(res, 200, result);
      }

      throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
    } catch (rawError) {
      const error = asWorldAppError(rawError);
      if (res.headersSent) {
        res.end();
        return;
      }
      const known = error instanceof AppError;
      const status = known ? error.status : 500;
      const code = known ? error.code : "INTERNAL_ERROR";
      const message = known ? error.message : "Unexpected server error.";
      if (!known) options.onError?.(error);
      sendJson(res, status, { error: { code, message, details: known ? error.details : undefined } });
    }
  }

  const server = http.createServer(handler);

  return {
    server,
    store,
    worldHostRunner,
    worldHostPrewarm,
    isReachable,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          selfUrl ??= `http://${host}:${address.port}`;
          resolve({ host, port: address.port, url: `http://${host}:${address.port}` });
        });
      });
    },
    async close() {
      for (const timer of interactionTimers.values()) cancelTimeout(timer);
      interactionTimers.clear();
      for (const devices of sseByPet.values()) {
        for (const res of devices.values()) res.end();
      }
      await worldHostRunner?.close();
      await new Promise((resolve) => server.close(resolve));
      if (!options.store) store.close();
    }
  };
}

export const createAgentWorldApp = createPetSocialApp;
