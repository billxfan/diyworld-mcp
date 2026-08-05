import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAgentWorldApp, createPetSocialApp } from "../src/app.mjs";
import { addCharacterAliases } from "../src/character-aliases.mjs";
import { AgentWorldClient, PetSocialClient } from "../src/client.mjs";
import { AgentWorldStore, PetSocialStore } from "../src/store.mjs";
import { SocialService } from "../src/venue-lab-core/social-service.js";
import { callWorldTool, worldTools } from "../src/world-tools.mjs";

test("a non-Codex Agent binding drives a persistent non-pet character", () => {
  const store = new PetSocialStore();
  try {
    const registration = store.register({
      recoveryEmail: "robot-owner@example.test",
      displayName: "Atlas",
      deviceName: "Workshop Agent",
      characterForm: "robot",
      appearance: { shell: "brass", eyes: 2 },
      agentProvider: "custom",
      clientInstanceId: "workshop-agent-01"
    });
    const auth = store.authenticate(registration.token);

    assert.match(registration.character.id, /^chr_/u);
    assert.equal(auth.character_id, registration.pet.id);
    assert.equal(auth.binding_id, registration.agentBinding.id);
    assert.equal(registration.character.form, "robot");
    assert.deepEqual(registration.character.appearance, { shell: "brass", eyes: 2 });
    assert.equal(registration.agentBinding.provider, "custom");
    assert.equal(registration.agentBinding.characterId, registration.character.id);
    assert.equal(registration.agentBinding.clientInstanceId, "workshop-agent-01");
    assert.ok(registration.agentBinding.scopes.includes("world:participate"));

    const updated = store.updateCharacter(auth, {
      displayName: "Atlas Prime",
      form: "spirit",
      appearance: { aura: "blue" }
    });
    assert.equal(updated.name, "Atlas Prime");
    assert.equal(updated.form, "spirit");
    assert.deepEqual(updated.appearance, { aura: "blue" });
    assert.equal(store.getPet(registration.pet.id).display_name, "Atlas Prime");

    store.updatePet(auth, { bio: "Legacy tools still reach this character." });
    assert.equal(store.getCharacter(auth.character_id).bio, "Legacy tools still reach this character.");

    const worlds = new SocialService(store.db, auth.character_id, {
      identitySchema: "shared",
      principalUserId: auth.owner_id,
      principalSessionId: auth.binding_id
    });
    const world = worlds.createWorld({
      name: "开放工作台",
      rulesText: "所有形态的角色都可以参与。",
      definitionText: "一个用于验证非宠物角色能够创建世界的工作台。"
    });
    assert.equal(
      store.db.prepare("SELECT owner_pet_id FROM spaces WHERE id = ?").get(world.id).owner_pet_id,
      auth.character_id
    );
  } finally {
    store.close();
  }
});

test("neutral SDK names are additive aliases for compatibility exports", () => {
  assert.equal(AgentWorldClient, PetSocialClient);
  assert.equal(AgentWorldStore, PetSocialStore);
  assert.equal(createAgentWorldApp, createPetSocialApp);
});

test("an existing pet database is additively backfilled into Character and AgentBinding", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-identity-"));
  const databaseFile = join(directory, "legacy.sqlite");
  try {
    const original = new PetSocialStore(databaseFile);
    const registration = original.register({
      recoveryEmail: "legacy@example.test",
      displayName: "Legacy Pet"
    });
    original.db.exec("DROP TABLE agent_bindings; DROP TABLE characters;");
    original.close();

    const migrated = new PetSocialStore(databaseFile);
    try {
      const auth = migrated.authenticate(registration.token);
      const character = migrated.getCharacter(auth.character_id);
      const binding = migrated.getAgentBinding(auth);
      assert.equal(character.id, registration.pet.id);
      assert.equal(character.form, "pet");
      assert.deepEqual(character.appearance, {});
      assert.equal(binding.provider, "codex");
      assert.equal(binding.characterId, character.id);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("neutral HTTP endpoints preserve identity across Agent providers", async () => {
  let now = 5_000_000;
  const store = new PetSocialStore(":memory:", { now: () => now });
  const app = createPetSocialApp({ store, now: () => now });
  const address = await app.listen();
  try {
    const robotRegistration = await PetSocialClient.register(address.url, {
      recoveryEmail: "http-robot@example.test",
      displayName: "HTTP Robot",
      characterForm: "robot",
      agentProvider: "custom",
      clientInstanceId: "http-custom-agent"
    });
    const observerRegistration = await PetSocialClient.register(address.url, {
      recoveryEmail: "http-observer@example.test",
      displayName: "Observer"
    });
    const robot = new PetSocialClient({
      serverUrl: address.url,
      token: robotRegistration.token
    });
    const observer = new PetSocialClient({
      serverUrl: address.url,
      token: observerRegistration.token
    });

    const self = await robot.character();
    assert.equal(self.character.id, robotRegistration.pet.id);
    assert.equal(self.character.form, "robot");
    assert.equal((await robot.agentBinding()).agentBinding.provider, "custom");

    now += 1_000;
    await robot.agentHeartbeat(true, "custom-runtime/1.0");
    const discovered = await observer.characters();
    assert.equal(discovered.recent.length, 1);
    assert.equal(discovered.recent[0].id, robotRegistration.character.id);
    assert.equal(discovered.recent[0].form, "robot");

    const request = await robot.sendFriendRequest(observerRegistration.character.id);
    assert.equal(request.friendship.requesterCharacterId, robotRegistration.character.id);
    assert.equal(request.friendship.addresseeCharacterId, observerRegistration.character.id);
    const incoming = await observer.friendRequests("incoming");
    assert.equal(incoming.requests[0].character.id, robotRegistration.character.id);

    const updated = await robot.updateCharacter({
      form: "custom",
      appearance: { species: "cloud" }
    });
    assert.equal(updated.character.form, "custom");
    assert.deepEqual(updated.character.appearance, { species: "cloud" });

    const legacy = await robot.me();
    assert.equal(legacy.pet.id, updated.character.id);
    assert.equal(legacy.character.id, updated.character.id);
    assert.equal(legacy.agentBinding.provider, "custom");

    const legacyBlock = await robot.blockPet(observerRegistration.character.id);
    assert.equal(legacyBlock.petId, observerRegistration.character.id);
    assert.equal(legacyBlock.characterId, observerRegistration.character.id);
    const neutralBlock = await robot.blockCharacter(observerRegistration.character.id);
    assert.equal(neutralBlock.petId, observerRegistration.character.id);
    assert.equal(neutralBlock.characterId, observerRegistration.character.id);
    assert.equal(neutralBlock.friendshipId, legacyBlock.friendshipId);
    assert.equal(neutralBlock.idempotent, true);
  } finally {
    await app.close();
    store.close();
  }
});

test("the MCP contract exposes profile and people tools", () => {
  const mcpSource = readFileSync(
    new URL("../src/mcp-server.mjs", import.meta.url),
    "utf8"
  );
  for (const name of [
    "profile_get",
    "profile_update",
    "agent_binding_get",
    "agent_binding_list",
    "agent_binding_revoke",
    "people_discover",
    "people_block"
  ]) {
    assert.match(mcpSource, new RegExp(`name: ["']${name}["']`));
  }
  for (const name of [
    "world_admin_add",
    "world_admin_remove",
    "world_invitation_create"
  ]) {
    const tool = worldTools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.ok(tool.inputSchema.properties.target_character_id);
    assert.deepEqual(tool.inputSchema.anyOf, [
      { required: ["target_character_id"] },
      { required: ["target_pet_id"] }
    ]);
  }
  const joinResponse = worldTools.find(
    (candidate) => candidate.name === "world_join_request_respond"
  );
  assert.ok(joinResponse.inputSchema.properties.applicant_character_id);
  assert.deepEqual(joinResponse.inputSchema.anyOf, [
    { required: ["applicant_character_id"] },
    { required: ["applicant_pet_id"] }
  ]);
});

test("legacy social and World identifiers gain additive Character aliases", async () => {
  const aliased = addCharacterAliases({
    pet: { id: "pet_actor" },
    actor_pet_id: "pet_actor",
    senderPetId: "pet_sender",
    nested: [{ target_pet_id: "pet_target" }],
    data: { actor_pet_id: "creator-defined-value" }
  });
  assert.equal(aliased.character.id, "pet_actor");
  assert.equal(aliased.actor_character_id, "pet_actor");
  assert.equal(aliased.senderCharacterId, "pet_sender");
  assert.equal(aliased.nested[0].target_character_id, "pet_target");
  assert.equal(aliased.data.actor_character_id, undefined);
  assert.equal(aliased.data.actor_pet_id, "creator-defined-value");

  const worldResult = await callWorldTool(
    {
      worldPresent: async () => ({
        world_id: "world_alias",
        present: [{ pet_id: "pet_present", name: "Present Character" }]
      })
    },
    "world_present",
    { world_id: "world_alias" }
  );
  assert.equal(worldResult.present[0].character_id, "pet_present");
  assert.equal(worldResult.present[0].pet_id, "pet_present");
});

test("generic Agent activity remains visible to legacy discovery and Character IDs need no Pet prefix", async () => {
  let now = 9_000_000;
  const store = new AgentWorldStore(":memory:", { now: () => now });
  const app = createAgentWorldApp({ store, now: () => now });
  const address = await app.listen();
  try {
    const observerRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "discovery-observer@example.test",
      displayName: "Observer",
      characterForm: "humanlike",
      agentProvider: "other"
    });
    const targetRegistration = await AgentWorldClient.register(address.url, {
      recoveryEmail: "discovery-target@example.test",
      displayName: "Generic Active Agent",
      characterForm: "robot",
      agentProvider: "custom"
    });
    const observer = new AgentWorldClient({
      serverUrl: address.url,
      token: observerRegistration.token
    });
    const target = new AgentWorldClient({
      serverUrl: address.url,
      token: targetRegistration.token
    });
    now += 1_000;
    await target.agentHeartbeat(true, "generic-runtime/1.0");
    const neutralIds = [
      ...(await observer.characters()).active,
      ...(await observer.characters()).recent
    ].map((item) => item.id).sort();
    const legacySquare = await observer.square();
    const legacyIds = [...legacySquare.active, ...legacySquare.recent]
      .map((item) => item.id)
      .sort();
    assert.deepEqual(legacyIds, neutralIds);
    assert.ok(neutralIds.includes(targetRegistration.character.id));

    store.db.prepare("INSERT INTO owners (id, recovery_email, created_at) VALUES (?, ?, ?)")
      .run("owner_character_prefix", "prefix@example.test", now);
    store.db.prepare(`
      INSERT INTO pets (
        id, owner_id, display_name, handle, bio, visibility, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', 'public', 'active', ?, ?)
    `).run(
      "character_external_id",
      "owner_character_prefix",
      "Prefixless Character",
      "prefixless-character",
      now,
      now
    );
    store.db.prepare(`
      INSERT INTO characters (
        id, owner_id, form, appearance_json, status, created_at, updated_at
      ) VALUES (?, ?, 'custom', '{}', 'active', ?, ?)
    `).run("character_external_id", "owner_character_prefix", now, now);
    assert.equal(
      store.resolveTarget("character_external_id").id,
      "character_external_id"
    );
  } finally {
    await app.close();
    store.close();
  }
});
