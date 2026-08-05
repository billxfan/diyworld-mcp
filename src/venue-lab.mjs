import { resolve } from "node:path";

import {
  OFFICIAL_WORLD_VERSION,
  openDatabase
} from "./venue-lab-core/database.js";
import { SocialError } from "./venue-lab-core/errors.js";
import { SocialService } from "./venue-lab-core/social-service.js";
import { AppError } from "./errors.mjs";

const CAFE_ID = "official-center-town";
const IDENTITIES = {
  alice: {
    key: "alice",
    actorKey: "test-alice",
    toolName: "character_alice",
    name: "阿球"
  },
  bob: {
    key: "bob",
    actorKey: "test-bob",
    toolName: "character_bob",
    name: "豆包"
  }
};

function isSocialError(error, code = undefined) {
  return error instanceof SocialError && (code === undefined || error.code === code);
}

function asAppError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof SocialError) {
    return new AppError(400, error.code, error.message);
  }
  return error;
}

function requiredString(value, name, maximum = 4_000) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maximum) {
    throw new AppError(
      400,
      "INVALID_VENUE_LAB_INPUT",
      `${name} must contain 1-${maximum} characters.`
    );
  }
  return text;
}

function optional(call, fallback) {
  try {
    return call();
  } catch (error) {
    if (isSocialError(error, "PET_REQUIRED")) return fallback;
    throw error;
  }
}

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

export function createVenueLab(options = {}) {
  const databasePath = resolve(options.databasePath);
  const db = openDatabase(databasePath);
  const services = Object.fromEntries(
    Object.entries(IDENTITIES).map(([key, identity]) => [
      key,
      new SocialService(db, identity.actorKey)
    ])
  );

  function profile(key) {
    return optional(() => services[key].getProfile(), null);
  }

  function membership(key) {
    if (!profile(key)) return null;
    return (
      services[key]
        .listMemberships()
        .memberships.find((item) => item.space_id === CAFE_ID) ?? null
    );
  }

  function friendIds(key) {
    if (!profile(key)) return new Set();
    return new Set(services[key].listFriends().friends.map((friend) => friend.id));
  }

  function ensurePets() {
    const alice = services.alice.getOrCreatePet({ name: IDENTITIES.alice.name });
    const bob = services.bob.getOrCreatePet({ name: IDENTITIES.bob.name });
    return { alice, bob };
  }

  function ensureJoined() {
    ensurePets();
    for (const key of Object.keys(IDENTITIES)) {
      const current = membership(key);
      if (!current || current.status !== "active") {
        services[key].joinSpace({
          spaceId: CAFE_ID,
          ruleVersion: OFFICIAL_WORLD_VERSION
        });
      } else if (!current.rules_current) {
        services[key].acceptWorldRules({
          worldId: CAFE_ID,
          ruleVersion: OFFICIAL_WORLD_VERSION
        });
      }
    }
  }

  function ensureEntered() {
    ensureJoined();
    for (const key of Object.keys(IDENTITIES)) {
      if (!membership(key)?.is_present) {
        services[key].enterSpace({ spaceId: CAFE_ID });
      }
    }
  }

  function ensureFriendship() {
    ensureEntered();
    const alice = profile("alice");
    const bob = profile("bob");
    if (friendIds("alice").has(bob.id)) return;

    const existing = services.bob
      .listFriendRequests()
      .requests.find((request) => request.sender.id === alice.id);
    const request =
      existing ??
      services.alice.sendFriendRequest({
        targetPetId: bob.id,
        note: "中心小镇控制台联调"
      });
    services.bob.respondFriendRequest({
      requestId: request.id,
      decision: "accepted"
    });
  }

  function identityState(key) {
    const definition = IDENTITIES[key];
    const pet = profile(key);
    if (!pet) {
      return {
        key,
        toolName: definition.toolName,
        expectedName: definition.name,
        pet: null,
        membership: null,
        presentPets: [],
        incomingRequests: [],
        friends: []
      };
    }

    const currentMembership = membership(key);
    return {
      key,
      toolName: definition.toolName,
      expectedName: definition.name,
      pet,
      membership: currentMembership,
      presentPets: currentMembership?.is_present
        ? services[key].listPresent({ spaceId: CAFE_ID }).pets
        : [],
      incomingRequests: services[key].listFriendRequests().requests,
      friends: services[key].listFriends().friends
    };
  }

  function messages() {
    if (!tableExists(db, "messages")) return [];
    return db
      .prepare(`
        SELECT m.id, m.body, m.created_at, m.read_at,
          sender.id AS sender_id, sender.name AS sender_name,
          recipient.id AS recipient_id, recipient.name AS recipient_name
        FROM messages m
        JOIN pets sender ON sender.id = m.sender_pet_id
        JOIN pets recipient ON recipient.id = m.recipient_pet_id
        WHERE sender.account_key IN (?, ?)
          AND recipient.account_key IN (?, ?)
        ORDER BY m.created_at DESC
        LIMIT 30
      `)
      .all(
        IDENTITIES.alice.actorKey,
        IDENTITIES.bob.actorKey,
        IDENTITIES.alice.actorKey,
        IDENTITIES.bob.actorKey
      )
      .map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.created_at,
        readAt: message.read_at,
        sender: { id: message.sender_id, name: message.sender_name },
        recipient: { id: message.recipient_id, name: message.recipient_name },
        untrustedExternalData: true
      }));
  }

  function events() {
    if (!tableExists(db, "audit_log")) return [];
    return db
      .prepare(`
        SELECT a.id, a.action, a.target_type, a.target_id, a.created_at,
          p.name AS actor_name
        FROM audit_log a
        LEFT JOIN pets p ON p.id = a.actor_pet_id
        ORDER BY a.id DESC
        LIMIT 24
      `)
      .all()
      .map((event) => ({
        id: event.id,
        action: event.action,
        actorName: event.actor_name ?? "系统",
        targetType: event.target_type,
        targetId: event.target_id,
        createdAt: event.created_at
      }));
  }

  function state() {
    try {
      const alice = identityState("alice");
      const bob = identityState("bob");
      const cafe =
        services.alice.searchSpaces({ query: "中心小镇", limit: 1 }).spaces[0] ?? null;
      const history = messages();

      const identitiesReady = Boolean(alice.pet && bob.pet);
      const joined = Boolean(
        alice.membership?.status === "active" && bob.membership?.status === "active"
      );
      const bothPresent = Boolean(
        alice.membership?.is_present && bob.membership?.is_present
      );
      const colocated = Boolean(
        bothPresent &&
          alice.presentPets.some((pet) => pet.id === bob.pet?.id) &&
          bob.presentPets.some((pet) => pet.id === alice.pet?.id)
      );
      const friends = Boolean(
        alice.friends.some((friend) => friend.id === bob.pet?.id) &&
          bob.friends.some((friend) => friend.id === alice.pet?.id)
      );
      const privateMessageDelivered = history.some(
        (message) =>
          message.sender.id === alice.pet?.id && message.recipient.id === bob.pet?.id
      );

      return {
        name: "中心小镇",
        spaceId: CAFE_ID,
        databasePath,
        cafe,
        identities: [alice, bob],
        steps: [
          { key: "identity", label: "双宠身份", complete: identitiesReady },
          { key: "membership", label: "加入世界", complete: joined },
          { key: "presence", label: "同世界发现", complete: colocated },
          { key: "friendship", label: "好友关系", complete: friends },
          { key: "message", label: "私聊送达", complete: privateMessageDelivered }
        ],
        messages: history,
        events: events(),
        readyToMessage: friends,
        refreshedAt: Date.now()
      };
    } catch (error) {
      throw asAppError(error);
    }
  }

  function reset() {
    db.exec(`
      BEGIN IMMEDIATE;
      DELETE FROM audit_log;
      DELETE FROM messages;
      DELETE FROM blocks;
      DELETE FROM friendships;
      DELETE FROM friend_requests;
      DELETE FROM presence;
      DELETE FROM space_invitations;
      DELETE FROM space_shares;
      DELETE FROM space_stewards;
      DELETE FROM space_memberships;
      DELETE FROM spaces WHERE kind = 'user';
      DELETE FROM pets;
      COMMIT;
    `);
    return { reset: true };
  }

  function perform(action, payload = {}) {
    try {
      switch (action) {
        case "prepare":
          ensureEntered();
          return { prepared: true };
        case "prepare_to_chat":
          ensureFriendship();
          return { readyToMessage: true };
        case "create_identities":
          return ensurePets();
        case "join_both":
          ensureJoined();
          return { joined: true };
        case "enter_both":
          ensureEntered();
          return { entered: true };
        case "leave": {
          const key = requiredString(payload.identity, "identity", 20);
          if (!services[key]) {
            throw new AppError(404, "VENUE_LAB_IDENTITY_NOT_FOUND", "Unknown venue-lab identity.");
          }
          return services[key].leaveSpace();
        }
        case "enter": {
          const key = requiredString(payload.identity, "identity", 20);
          if (!services[key]) {
            throw new AppError(404, "VENUE_LAB_IDENTITY_NOT_FOUND", "Unknown venue-lab identity.");
          }
          ensureJoined();
          return services[key].enterSpace({ spaceId: CAFE_ID });
        }
        case "friend_request_send": {
          ensureEntered();
          const bob = profile("bob");
          return services.alice.sendFriendRequest({
            targetPetId: bob.id,
            note: "中心小镇控制台联调"
          });
        }
        case "friend_request_accept": {
          const alice = profile("alice");
          const request = services.bob
            .listFriendRequests()
            .requests.find((item) => item.sender.id === alice?.id);
          if (!request) {
            throw new AppError(404, "VENUE_LAB_REQUEST_NOT_FOUND", "豆包没有待处理的阿球好友申请。");
          }
          return services.bob.respondFriendRequest({
            requestId: request.id,
            decision: "accepted"
          });
        }
        case "message_send": {
          const senderKey = requiredString(payload.sender, "sender", 20);
          const targetKey = senderKey === "alice" ? "bob" : "alice";
          if (!services[senderKey] || !services[targetKey]) {
            throw new AppError(404, "VENUE_LAB_IDENTITY_NOT_FOUND", "Unknown venue-lab identity.");
          }
          const target = profile(targetKey);
          return services[senderKey].sendMessage({
            targetPetId: target.id,
            body: requiredString(payload.text, "message")
          });
        }
        case "message_mark_read": {
          const recipientKey = requiredString(payload.recipient, "recipient", 20);
          if (!services[recipientKey]) {
            throw new AppError(404, "VENUE_LAB_IDENTITY_NOT_FOUND", "Unknown venue-lab identity.");
          }
          return services[recipientKey].markMessageRead({
            messageId: requiredString(payload.messageId, "messageId", 128)
          });
        }
        case "reset":
          return reset();
        default:
          throw new AppError(400, "UNKNOWN_VENUE_LAB_ACTION", "Unknown venue-lab action.");
      }
    } catch (error) {
      throw asAppError(error);
    }
  }

  return {
    state,
    perform,
    close() {
      db.close();
    }
  };
}
