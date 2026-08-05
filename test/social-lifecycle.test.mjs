import assert from "node:assert/strict";
import test from "node:test";
import { createPetSocialApp } from "../src/app.mjs";
import { PetSocialClient } from "../src/client.mjs";
import { PetSocialStore } from "../src/store.mjs";
import { DAY_MS } from "../src/utils.mjs";
import { SocialService } from "../src/venue-lab-core/social-service.js";

function register(store, suffix) {
  const result = store.register({
    recoveryEmail: `${suffix}@example.test`,
    displayName: `pet-${suffix}`,
    deviceName: `device-${suffix}`
  });
  return {
    ...result,
    auth: store.authenticate(result.token)
  };
}

function becomeFriends(store, left, right) {
  const request = store.sendFriendRequest(left.auth, {
    targetPetId: right.pet.id,
    clientRequestId: `request-${left.pet.id}-${right.pet.id}`
  });
  const accepted = store.respondFriendRequest(right.auth, request.friendship.id, "accept");
  return {
    friendshipId: accepted.friendship.id,
    conversationId: store.listFriends(left.auth)[0].conversationId
  };
}

test("the database enforces one pet per owner", () => {
  const store = new PetSocialStore();
  try {
    const account = register(store, "single-pet");
    assert.throws(() => {
      store.db.prepare(`
        INSERT INTO pets (
          id, owner_id, display_name, handle, bio, visibility, status, created_at, updated_at
        ) VALUES ('pet_second', ?, 'second', 'second-handle', '', 'public', 'active', 1, 1)
      `).run(account.owner.id);
    }, /UNIQUE constraint failed: pets\.owner_id/);
  } finally {
    store.close();
  }
});

test("the first invite wave receives one referral each and registration stops at the cap", () => {
  const store = new PetSocialStore();
  try {
    const seed = store.createInvite({ label: "seed-wave", maxUses: 4 });
    const first = store.register({
      recoveryEmail: "referral-first@example.test",
      displayName: "referral-first",
      inviteCode: seed.code,
    }, {
      inviteRequired: true,
      registrationLimit: 4,
      referralInviteGrantLimit: 2,
    });
    const second = store.register({
      recoveryEmail: "referral-second@example.test",
      displayName: "referral-second",
      inviteCode: seed.code,
    }, {
      inviteRequired: true,
      registrationLimit: 4,
      referralInviteGrantLimit: 2,
    });
    assert.equal(first.referralInvite.maxUses, 1);
    assert.equal(first.referralInvite.registrationOrdinal, 1);
    assert.equal(second.referralInvite.registrationOrdinal, 2);

    const third = store.register({
      recoveryEmail: "referral-third@example.test",
      displayName: "referral-third",
      inviteCode: first.referralInvite.code,
    }, {
      inviteRequired: true,
      registrationLimit: 4,
      referralInviteGrantLimit: 2,
    });
    const fourth = store.register({
      recoveryEmail: "referral-fourth@example.test",
      displayName: "referral-fourth",
      inviteCode: second.referralInvite.code,
    }, {
      inviteRequired: true,
      registrationLimit: 4,
      referralInviteGrantLimit: 2,
    });
    assert.equal(third.referralInvite, null);
    assert.equal(fourth.referralInvite, null);
    assert.throws(
      () => store.register({
        recoveryEmail: "referral-fifth@example.test",
        displayName: "referral-fifth",
        inviteCode: seed.code,
      }, {
        inviteRequired: true,
        registrationLimit: 4,
        referralInviteGrantLimit: 2,
      }),
      (error) => error.code === "REGISTRATION_LIMIT_REACHED",
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS count FROM owners").get().count,
      4,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS count FROM referral_invite_grants").get().count,
      2,
    );
  } finally {
    store.close();
  }
});

test("an expired incoming request is hidden and a reverse request does not auto-accept", () => {
  let now = 1_000_000;
  const store = new PetSocialStore(":memory:", { now: () => now });
  try {
    const left = register(store, "expiry-left");
    const right = register(store, "expiry-right");
    store.sendFriendRequest(left.auth, {
      targetPetId: right.pet.id,
      clientRequestId: "expired-request"
    });

    now += 31 * DAY_MS;
    assert.deepEqual(store.listFriendRequests(right.auth, "incoming"), []);
    store.db.prepare("UPDATE pets SET last_codex_open_at = ? WHERE id = ?").run(now, left.pet.id);
    const square = store.listSquare(right.auth, {
      recentWindowMs: 7 * DAY_MS,
      isReachable: () => false,
      limit: 20
    });
    assert.equal(square.recent[0].relationship, "none");
    assert.equal(square.recent[0].canAdd, true);

    const reverse = store.sendFriendRequest(right.auth, {
      targetPetId: left.pet.id,
      clientRequestId: "fresh-reverse-request"
    });
    assert.equal(reverse.friendship.status, "pending");
    assert.equal(reverse.friendship.requester_pet_id, right.pet.id);
    assert.equal(reverse.autoAccepted, undefined);
  } finally {
    store.close();
  }
});

test("messages reject whitespace and read cursors cannot jump beyond existing history", () => {
  const store = new PetSocialStore();
  try {
    const left = register(store, "message-left");
    const right = register(store, "message-right");
    const relationship = becomeFriends(store, left, right);

    assert.throws(() => {
      store.sendMessage(left.auth, {
        conversationId: relationship.conversationId,
        clientMessageId: "whitespace",
        text: " \n\t "
      });
    }, (error) => error.code === "INVALID_MESSAGE");

    store.sendMessage(left.auth, {
      conversationId: relationship.conversationId,
      clientMessageId: "real-message",
      text: "hello"
    });
    const firstRead = store.markRead(right.auth, relationship.conversationId, 999);
    assert.equal(firstRead.maxSequenceNo, 1);
    assert.equal(firstRead.events.length, 1);

    const repeatedRead = store.markRead(right.auth, relationship.conversationId, 999);
    assert.equal(repeatedRead.maxSequenceNo, 1);
    assert.deepEqual(repeatedRead.events, []);
  } finally {
    store.close();
  }
});

test("account deletion requires two-step confirmation and anonymizes retained contact history", () => {
  const store = new PetSocialStore();
  try {
    const left = register(store, "delete-left");
    const right = register(store, "delete-right");
    const oldHandle = left.pet.handle;
    const worldService = new SocialService(store.db, left.pet.id, {
      identitySchema: "shared"
    });
    const ownedWorld = worldService.createWorld({
      name: "待关闭世界",
      rulesText: "注销后不再继续运行。",
      definitionText: "用于验证账号注销时的世界收尾。"
    });
    worldService.publishWorld({
      worldId: ownedWorld.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1
    });
    const relationship = becomeFriends(store, left, right);
    store.sendMessage(left.auth, {
      conversationId: relationship.conversationId,
      clientMessageId: "left-message",
      text: "left says hello"
    });
    store.sendMessage(right.auth, {
      conversationId: relationship.conversationId,
      clientMessageId: "right-message",
      text: "right replies"
    });

    const confirmation = store.requestAccountDeletion(left.auth);
    assert.match(confirmation.warning, /角色/);
    assert.doesNotMatch(confirmation.warning, /宠物|Codex/i);
    assert.throws(() => {
      store.deleteAccount(left.auth, {
        confirmationToken: confirmation.confirmationToken,
        confirmationText: "delete"
      });
    }, (error) => error.code === "ACCOUNT_DELETION_NOT_CONFIRMED");

    const result = store.deleteAccount(left.auth, {
      confirmationToken: confirmation.confirmationToken,
      confirmationText: "确认注销"
    });
    assert.equal(result.deleted, true);
    assert.equal(result.historyRetainedForContacts, true);
    assert.throws(() => store.authenticate(left.token), (error) => error.code === "UNAUTHORIZED");
    assert.equal(store.getPet(left.pet.id).display_name, "账号已注销");
    assert.equal(store.getPet(left.pet.id).status, "deleted");
    assert.equal(store.getPetByHandle(oldHandle), undefined);
    assert.equal(
      store.db
        .prepare("SELECT publication_status FROM spaces WHERE id = ?")
        .get(ownedWorld.id).publication_status,
      "closed"
    );
    assert.equal(
      store.db
        .prepare(`
          SELECT status FROM space_memberships
          WHERE space_id = ? AND pet_id = ?
        `)
        .get(ownedWorld.id, left.pet.id).status,
      "withdrawn"
    );
    assert.deepEqual(store.listFriends(right.auth), []);
    const replacement = store.register({
      recoveryEmail: "delete-left@example.test",
      displayName: "replacement"
    });
    assert.notEqual(replacement.owner.id, left.owner.id);
    assert.notEqual(replacement.pet.id, left.pet.id);

    const retained = store.listInbox(right.auth);
    assert.equal(retained.length, 2);
    assert.equal(retained.some((message) => message.sender.name === "账号已注销"), true);
    assert.equal(retained.some((message) => message.recipient.name === "账号已注销"), true);
  } finally {
    store.close();
  }
});

test("the HTTP client completes the two-step deletion flow", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const leftRegistration = await PetSocialClient.register(address.url, {
      recoveryEmail: "http-left@example.test",
      displayName: "http-left"
    });
    const rightRegistration = await PetSocialClient.register(address.url, {
      recoveryEmail: "http-right@example.test",
      displayName: "http-right"
    });
    const left = new PetSocialClient({ serverUrl: address.url, token: leftRegistration.token });
    const right = new PetSocialClient({ serverUrl: address.url, token: rightRegistration.token });

    const request = await left.sendFriendRequest(rightRegistration.pet.id);
    await right.respondFriendRequest(request.friendship.id, "accept");
    await left.sendMessage({ target: rightRegistration.pet.id, text: "retained" });

    const confirmation = await left.requestAccountDeletion();
    const deleted = await left.deleteAccount({
      confirmationToken: confirmation.confirmationToken,
      confirmationText: confirmation.confirmationText
    });
    assert.equal(deleted.deleted, true);
    await assert.rejects(() => left.me(), (error) => error.code === "UNAUTHORIZED");

    const inbox = await right.inbox();
    assert.equal(inbox.messages.length, 1);
    assert.equal(inbox.messages[0].sender.name, "账号已注销");
  } finally {
    await app.close();
    store.close();
  }
});

test("account recovery codes are short-lived, single-use, and issue a new device token", () => {
  let now = 2_000_000;
  const store = new PetSocialStore(":memory:", { now: () => now });
  try {
    const original = register(store, "recoverable");
    const recovery = store.createAccountRecovery({
      recoveryEmail: "recoverable@example.test",
      expiresAt: now + 15 * 60 * 1000
    });

    const recovered = store.recoverAccount({
      recoveryEmail: "recoverable@example.test",
      recoveryCode: recovery.recoveryCode,
      deviceName: "Replacement Mac"
    });
    assert.equal(recovered.owner.id, original.owner.id);
    assert.equal(recovered.pet.id, original.pet.id);
    assert.notEqual(recovered.device.id, original.device.id);
    assert.equal(store.authenticate(recovered.token).owner_id, original.owner.id);

    assert.throws(() => {
      store.recoverAccount({
        recoveryEmail: "recoverable@example.test",
        recoveryCode: recovery.recoveryCode,
        deviceName: "Another Mac"
      });
    }, (error) => error.code === "INVALID_RECOVERY_CODE");

    const expired = store.createAccountRecovery({
      recoveryEmail: "recoverable@example.test",
      expiresAt: now + 1
    });
    now += 2;
    assert.throws(() => {
      store.recoverAccount({
        recoveryEmail: "recoverable@example.test",
        recoveryCode: expired.recoveryCode,
        deviceName: "Late Mac"
      });
    }, (error) => error.code === "RECOVERY_CODE_EXPIRED");
  } finally {
    store.close();
  }
});

test("the HTTP client recovers an existing pet without creating a second account", async () => {
  const store = new PetSocialStore();
  const app = createPetSocialApp({ store });
  const address = await app.listen();
  try {
    const original = await PetSocialClient.register(address.url, {
      recoveryEmail: "http-recovery@example.test",
      displayName: "recover-me"
    });
    const recovery = store.createAccountRecovery({
      recoveryEmail: "http-recovery@example.test",
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    const recovered = await PetSocialClient.recover(address.url, {
      recoveryEmail: "http-recovery@example.test",
      recoveryCode: recovery.recoveryCode,
      deviceName: "Recovered Mac"
    });
    assert.equal(recovered.owner.id, original.owner.id);
    assert.equal(recovered.pet.id, original.pet.id);
    assert.notEqual(recovered.device.id, original.device.id);

    const recoveredClient = new PetSocialClient({
      serverUrl: address.url,
      token: recovered.token
    });
    assert.equal((await recoveredClient.me()).pet.id, original.pet.id);
  } finally {
    await app.close();
    store.close();
  }
});
