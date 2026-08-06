import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  OFFICIAL_WORLD_VERSION,
  OFFICIAL_WORLDS,
  openDatabase,
} from "../src/venue-lab-core/database.js";
import { SocialError } from "../src/venue-lab-core/errors.js";
import { SocialService } from "../src/venue-lab-core/social-service.js";

function createFixture() {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "world-owner");
  const visitor = new SocialService(db, "world-visitor");
  const outsider = new SocialService(db, "world-outsider");
  owner.getOrCreatePet({ name: "阿球" });
  visitor.getOrCreatePet({ name: "豆包" });
  outsider.getOrCreatePet({ name: "小火苗" });
  return { db, owner, visitor, outsider };
}

function expectCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof SocialError && error.code === code,
  );
}

function createDraft(service, overrides = {}) {
  return service.createWorld({
    name: "云端酒馆",
    description: "由创建者定义规则的开放小世界。",
    tags: ["社交", "UGC"],
    visibility: "public",
    joinPolicy: "open",
    rulesText: "尊重其他成员；世界内容不得突破平台安全边界。",
    definitionText:
      "这里是一间漂浮在云端的酒馆。创建者可以继续定义入场流程、场景和互动方式。",
    ...overrides,
  });
}

test("official worlds use one published model and expose the complete catalog", () => {
  const { db, owner } = createFixture();
  try {
    const worlds = owner.searchWorlds({ query: "", limit: 50 }).worlds;
    assert.deepEqual(
      worlds.map((world) => world.name),
      OFFICIAL_WORLDS.map((world) => world.name),
    );
    assert.ok(worlds.every((world) => world.publication_status === "published"));
    assert.ok(worlds.every((world) => world.definition_text.length > 20));
    assert.ok(worlds.every((world) => world.shortcut.startsWith("/world ")));
  } finally {
    db.close();
  }
});

test("a creator can draft, revise, publish, and delegate a world without exposing drafts", () => {
  const { db, owner, visitor, outsider } = createFixture();
  try {
    const draft = createDraft(owner);
    assert.equal(draft.publication_status, "draft");
    assert.equal(visitor.searchWorlds({ query: "云端酒馆" }).worlds.length, 0);
    expectCode(() => visitor.getWorld({ worldId: draft.id }), "NOT_FOUND");
    expectCode(
      () =>
        owner.updateWorld({
          worldId: draft.id,
          description: "缺少展示资料并发版本。",
        }),
      "INVALID_ARGUMENT",
    );
    expectCode(
      () =>
        owner.updateWorld({
          worldId: draft.id,
          rulesText: "缺少规则并发版本。",
        }),
      "INVALID_ARGUMENT",
    );

    const revised = owner.updateWorld({
      worldId: draft.id,
      expectedVersion: 1,
      expectedProfileVersion: 1,
      description: "一间允许创建者自由改变规则的云端酒馆。",
      definitionText:
        "这里是一间漂浮在云端的酒馆。进入后会发生什么，完全由世界创建者当前发布的定义决定。",
    });
    assert.equal(revised.spec_version, 2);
    assert.equal(revised.rule_version, 1);

    expectCode(
      () =>
        owner.publishWorld({
          worldId: draft.id,
          expectedSpecVersion: 2,
        }),
      "INVALID_ARGUMENT",
    );

    expectCode(
      () =>
        visitor.updateWorld({
          worldId: draft.id,
          expectedVersion: 2,
          description: "越权修改",
        }),
      "NOT_FOUND",
    );

    const published = owner.publishWorld({
      worldId: draft.id,
      expectedSpecVersion: 2,
      expectedRuleVersion: 1,
      expectedProfileVersion: 2,
      expectedHostVersion: 1,
    });
    assert.equal(published.publication_status, "published");
    assert.equal(
      visitor.searchWorlds({ query: "云端酒馆" }).worlds[0].id,
      draft.id,
    );

    const membership = visitor.joinWorld({
      worldId: draft.id,
      ruleVersion: 1,
    }).membership;
    assert.equal(membership.status, "active");

    expectCode(
      () =>
        outsider.updateWorld({
          worldId: draft.id,
          expectedVersion: 2,
          description: "越权修改",
        }),
      "FORBIDDEN",
    );

    const visitorPet = visitor.getProfile();
    owner.addWorldAdmin({ worldId: draft.id, targetPetId: visitorPet.id });
    const adminRevision = visitor.updateWorld({
      worldId: draft.id,
      expectedVersion: 2,
      expectedRuleVersion: 1,
      rulesText: "尊重其他成员；管理员可以协助维护世界。",
    });
    assert.equal(adminRevision.spec_version, 2);
    assert.equal(adminRevision.rule_version, 2);
    assert.equal(
      owner.removeWorldAdmin({
        worldId: draft.id,
        targetPetId: visitorPet.id,
      }).removed,
      true,
    );
    expectCode(
      () =>
        visitor.updateWorld({
          worldId: draft.id,
          expectedProfileVersion: 2,
          description: "被撤销的管理员不能继续修改世界。",
        }),
      "FORBIDDEN",
    );

    expectCode(
      () => visitor.enterWorld({ worldId: draft.id }),
      "RULE_VERSION_MISMATCH",
    );
    visitor.acceptWorldRules({ worldId: draft.id, ruleVersion: 2 });
    assert.equal(visitor.enterWorld({ worldId: draft.id }).world.id, draft.id);
  } finally {
    db.close();
  }
});

test("only the creator can close, reopen, and permanently delete a user World", () => {
  const { db, owner, visitor, outsider } = createFixture();
  try {
    const draft = createDraft(owner, { name: "生命周期测试岛" });
    const draftForDeletion = createDraft(owner, { name: "待删除草稿" });
    const deletedDraft = owner.deleteWorld({
      worldId: draftForDeletion.id,
      confirmed: true,
    });
    assert.equal(deletedDraft.deleted, true);
    assert.equal(
      db.prepare("SELECT 1 FROM spaces WHERE id = ?").get(draftForDeletion.id),
      undefined,
    );

    owner.publishWorld({
      worldId: draft.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    visitor.joinWorld({ worldId: draft.id, ruleVersion: 1 });
    visitor.enterWorld({
      worldId: draft.id,
      clientSessionId: "lifecycle-visitor-session",
    });
    owner.addWorldAdmin({
      worldId: draft.id,
      targetPetId: visitor.getProfile().id,
    });

    expectCode(
      () => owner.deleteWorld({ worldId: draft.id, confirmed: true }),
      "WORLD_MUST_BE_CLOSED",
    );
    expectCode(
      () => visitor.closeWorld({ worldId: draft.id }),
      "FORBIDDEN",
    );

    const closed = owner.closeWorld({ worldId: draft.id });
    assert.equal(closed.publication_status, "closed");
    assert.equal(
      outsider.searchWorlds({ query: "生命周期测试岛" }).worlds.length,
      0,
    );
    expectCode(
      () =>
        visitor.enterWorld({
          worldId: draft.id,
          clientSessionId: "lifecycle-visitor-session",
        }),
      "WORLD_NOT_PUBLISHED",
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM presence WHERE space_id = ?")
        .get(draft.id).count,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM world_sessions WHERE space_id = ? AND status = 'active'",
        )
        .get(draft.id).count,
      0,
    );

    const reopened = owner.publishWorld({
      worldId: draft.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    assert.equal(reopened.publication_status, "published");
    assert.equal(
      visitor.enterWorld({
        worldId: draft.id,
        clientSessionId: "lifecycle-visitor-session",
      }).world.id,
      draft.id,
    );

    owner.closeWorld({ worldId: draft.id });
    expectCode(
      () => owner.deleteWorld({ worldId: draft.id, confirmed: false }),
      "CONFIRMATION_REQUIRED",
    );
    expectCode(
      () => visitor.deleteWorld({ worldId: draft.id, confirmed: true }),
      "FORBIDDEN",
    );
    const deleted = owner.deleteWorld({
      worldId: draft.id,
      confirmed: true,
    });
    assert.deepEqual(deleted, {
      deleted: true,
      world_id: draft.id,
      name: "生命周期测试岛",
    });
    expectCode(() => owner.getWorld({ worldId: draft.id }), "NOT_FOUND");
  } finally {
    db.close();
  }
});

test("approval worlds keep applicants pending until an owner or admin accepts them", () => {
  const { db, owner, visitor } = createFixture();
  try {
    const draft = createDraft(owner, {
      name: "共建岛",
      joinPolicy: "approval",
    });
    owner.publishWorld({
      worldId: draft.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });

    const application = visitor.joinWorld({
      worldId: draft.id,
      ruleVersion: 1,
      applicationText: "我想参与共同建设。",
    });
    assert.equal(application.membership.status, "pending");
    expectCode(
      () => visitor.enterWorld({ worldId: draft.id }),
      "ACTIVE_MEMBERSHIP_REQUIRED",
    );

    const request = owner.listWorldJoinRequests({ worldId: draft.id }).requests[0];
    assert.equal(request.application_text, "我想参与共同建设。");
    owner.respondWorldJoinRequest({
      worldId: draft.id,
      applicantPetId: request.applicant.id,
      decision: "accepted",
    });
    assert.equal(visitor.enterWorld({ worldId: draft.id }).world.id, draft.id);
  } finally {
    db.close();
  }
});

test("unlisted worlds require a valid share and never appear in public search", () => {
  const { db, owner, visitor } = createFixture();
  try {
    const draft = createDraft(owner, {
      name: "秘密花园",
      visibility: "unlisted",
    });
    owner.publishWorld({
      worldId: draft.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });

    assert.equal(visitor.searchWorlds({ query: "秘密花园" }).worlds.length, 0);
    expectCode(
      () => visitor.joinWorld({ worldId: draft.id, ruleVersion: 1 }),
      "SHARE_REQUIRED",
    );

    const share = owner.createWorldShare({ worldId: draft.id, expiresInDays: 7 });
    const sharedWorld = visitor.openWorldShare({ token: share.token }).world;
    assert.equal(sharedWorld.id, draft.id);
    assert.equal(sharedWorld.rule_version, 1);
    const joined = visitor.joinWorld({
      worldId: sharedWorld.id,
      ruleVersion: sharedWorld.rule_version,
      shareToken: share.token,
    });
    assert.equal(joined.membership.status, "active");
  } finally {
    db.close();
  }
});

test("hidden invite-only worlds can be joined only through a targeted invitation", () => {
  const { db, owner, visitor } = createFixture();
  try {
    for (const service of [owner, visitor]) {
      service.joinWorld({
        worldId: "official-center-town",
        ruleVersion: OFFICIAL_WORLD_VERSION,
      });
      service.enterWorld({ worldId: "official-center-town" });
    }
    const request = owner.sendFriendRequest({
      targetPetId: visitor.getProfile().id,
      note: "邀请你来我的世界。",
    });
    visitor.respondFriendRequest({
      requestId: request.id,
      decision: "accepted",
    });

    const draft = createDraft(owner, {
      name: "隐秘观星台",
      visibility: "hidden",
      joinPolicy: "invite_only",
    });
    owner.publishWorld({
      worldId: draft.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    assert.equal(
      visitor.searchWorlds({ query: "隐秘观星台" }).worlds.length,
      0,
    );
    expectCode(
      () => visitor.joinWorld({ worldId: draft.id, ruleVersion: 1 }),
      "INVITATION_REQUIRED",
    );

    const invitation = owner.createWorldInvitation({
      worldId: draft.id,
      targetPetId: visitor.getProfile().id,
    });
    assert.equal(
      visitor.listWorldInvitations().invitations[0].world_id,
      draft.id,
    );
    assert.equal(visitor.getWorld({ worldId: draft.id }).rule_version, 1);
    const joined = visitor.joinWorld({
      worldId: draft.id,
      ruleVersion: 1,
      invitationId: invitation.id,
    });
    assert.equal(joined.membership.status, "active");
  } finally {
    db.close();
  }
});

test("a hidden open World is discoverable only by its exact ID and can be joined directly", () => {
  const { db, owner, visitor } = createFixture();
  try {
    const draft = createDraft(owner, {
      name: "只凭 ID 抵达的世界",
      visibility: "hidden",
      joinPolicy: "open",
    });
    const world = owner.publishWorld({
      worldId: draft.id,
      expectedSpecVersion: draft.spec_version,
      expectedRuleVersion: draft.rule_version,
      expectedProfileVersion: draft.profile_version,
      expectedHostVersion: draft.world_agent.version,
    });
    assert.equal(
      visitor.searchWorlds({ query: world.name }).worlds.length,
      0,
    );
    const exact = visitor.searchWorlds({ query: world.id }).worlds;
    assert.equal(exact.length, 1);
    assert.equal(exact[0].id, world.id);
    assert.equal(visitor.getWorld({ worldId: world.id }).id, world.id);
    const joined = visitor.joinWorld({
      worldId: world.id,
      ruleVersion: world.rule_version,
    });
    assert.equal(joined.membership.status, "active");
  } finally {
    db.close();
  }
});

test("an existing venue database upgrades to World v0 without losing old records", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-pet-world-migration-"));
  const path = join(directory, "old-venue.sqlite");
  const oldDb = new DatabaseSync(path);
  oldDb.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL,
      join_policy TEXT NOT NULL,
      friend_policy TEXT NOT NULL,
      governance TEXT NOT NULL,
      owner_pet_id TEXT,
      current_rule_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE space_rule_versions (
      space_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      rules_text TEXT NOT NULL,
      visibility TEXT NOT NULL,
      join_policy TEXT NOT NULL,
      friend_policy TEXT NOT NULL,
      governance TEXT NOT NULL,
      created_by_pet_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (space_id, version)
    );
    INSERT INTO spaces VALUES (
      'official-world-entry', 'official', '旧入口', '旧数据', '[]',
      'public', 'open', 'enabled', 'immutable', NULL, 1,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
    INSERT INTO space_rule_versions VALUES (
      'official-world-entry', 1, '旧规则', 'public', 'open', 'enabled',
      'immutable', NULL, '2026-01-01T00:00:00.000Z'
    );
  `);
  oldDb.close();

  const upgraded = openDatabase(path);
  try {
    const columns = upgraded
      .prepare("PRAGMA table_info(spaces)")
      .all()
      .map((row) => row.name);
    assert.ok(columns.includes("publication_status"));
    assert.ok(columns.includes("definition_text"));
    const retired = upgraded
      .prepare("SELECT publication_status, visibility, join_policy FROM spaces WHERE id = ?")
      .get("official-world-entry");
    assert.equal(retired.publication_status, "closed");
    assert.equal(retired.visibility, "unlisted");
    assert.equal(retired.join_policy, "invite_only");
    assert.equal(
      upgraded
        .prepare(
          "SELECT COUNT(*) AS count FROM spaces WHERE kind = 'official' AND publication_status = 'published'",
        )
        .get().count,
      OFFICIAL_WORLDS.length,
    );
  } finally {
    upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("official catalog repair closes stale live sessions and requires renewed acceptance", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-pet-official-v2-"));
  const path = join(directory, "official-v1.sqlite");
  const initial = openDatabase(path);
  const actorKey = "official-v1-member";
  try {
    const member = new SocialService(initial, actorKey);
    member.getOrCreatePet({ name: "旧规则成员" });
    member.joinWorld({
      worldId: "official-center-town",
      ruleVersion: OFFICIAL_WORLD_VERSION,
    });
    member.enterWorld({
      worldId: "official-center-town",
      clientSessionId: "official-v1-live-session",
    });
    initial
      .prepare(`
        UPDATE spaces
        SET current_rule_version = 0, current_spec_version = 0
        WHERE id = 'official-center-town'
      `)
      .run();
    initial
      .prepare(`
        UPDATE space_memberships
        SET accepted_rule_version = 0
        WHERE space_id = 'official-center-town'
      `)
      .run();
  } finally {
    initial.close();
  }

  const upgraded = openDatabase(path);
  try {
    const world = upgraded
      .prepare(`
        SELECT current_rule_version, current_spec_version
        FROM spaces WHERE id = 'official-center-town'
      `)
      .get();
    assert.equal(world.current_rule_version, OFFICIAL_WORLD_VERSION);
    assert.equal(world.current_spec_version, OFFICIAL_WORLD_VERSION);
    assert.equal(
      upgraded
        .prepare(`
          SELECT COUNT(*) AS count FROM presence
          WHERE space_id = 'official-center-town'
        `)
        .get().count,
      0,
    );
    assert.equal(
      upgraded
        .prepare(`
          SELECT COUNT(*) AS count FROM world_sessions
          WHERE space_id = 'official-center-town' AND status = 'active'
        `)
        .get().count,
      0,
    );

    const member = new SocialService(upgraded, actorKey);
    expectCode(
      () =>
        member.enterWorld({
          worldId: "official-center-town",
          clientSessionId: "official-v2-live-session",
        }),
      "RULE_VERSION_MISMATCH",
    );
    member.acceptWorldRules({
      worldId: "official-center-town",
      ruleVersion: OFFICIAL_WORLD_VERSION,
    });
    assert.equal(
      member.enterWorld({
        worldId: "official-center-town",
        clientSessionId: "official-v2-live-session",
      }).world.rule_version,
      OFFICIAL_WORLD_VERSION,
    );
  } finally {
    upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Character-first MCP surface preserves legacy Pet compatibility", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-pet-world-mcp-"));
  const databasePath = join(directory, "venue.sqlite");
  const input = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "character_get_or_create",
        arguments: { name: "MCP测试角色" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "world_search", arguments: {} },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join("\n");

  const result = spawnSync(
    process.execPath,
    ["src/venue-lab-mcp.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        AGENT_WORLD_CHARACTER_ID: "mcp-world-tester",
        AGENT_WORLD_DB_PATH: databasePath,
      },
      input,
      encoding: "utf8",
    },
  );

  try {
    assert.equal(result.status, 0, result.stderr);
    const messages = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const toolNames = messages
      .find((message) => message.id === 2)
      .result.tools.map((tool) => tool.name);
    for (const name of [
      "character_get_or_create",
      "character_get_profile",
      "character_update_profile",
      "pet_get_or_create",
      "pet_get_profile",
      "pet_update_profile",
    ]) {
      assert.ok(toolNames.includes(name), `missing identity MCP tool: ${name}`);
    }
    for (const name of [
      "world_search",
      "world_get",
      "world_builder_templates",
      "world_builder_start",
      "world_builder_get",
      "world_builder_update",
      "world_builder_materialize",
      "world_create",
      "world_update",
      "world_publish",
      "world_close",
      "world_delete",
      "world_join",
      "world_rules_accept",
      "world_admin_add",
      "world_admin_remove",
      "world_share_create",
      "world_share_open",
      "world_invitation_create",
      "world_invitation_list",
      "world_join_request_list",
      "world_join_request_respond",
      "world_enter",
      "world_observe",
      "world_input_submit",
      "world_act",
      "world_intent_resolve",
      "world_events_ack",
      "world_delegation_set",
      "world_trigger_create",
      "world_trigger_list",
      "world_trigger_cancel",
    ]) {
      assert.ok(toolNames.includes(name), `missing MCP tool: ${name}`);
    }
    const listedTools = messages.find((message) => message.id === 2).result.tools;
    for (const name of [
      "world_admin_add",
      "world_admin_remove",
      "world_invitation_create",
      "friend_request_send",
      "friend_remove",
      "message_send",
    ]) {
      const tool = listedTools.find((candidate) => candidate.name === name);
      assert.ok(tool.inputSchema.properties.target_character_id);
      assert.deepEqual(tool.inputSchema.anyOf, [
        { required: ["target_character_id"] },
        { required: ["target_pet_id"] },
      ]);
    }
    const submitTool = listedTools.find(
      (tool) => tool.name === "world_input_submit",
    );
    assert.ok(
      submitTool.inputSchema.required.includes("observed_world_state_version"),
    );
    assert.ok(
      submitTool.inputSchema.required.includes("observed_member_state_version"),
    );
    const characterResult = messages.find((message) => message.id === 3);
    assert.equal(characterResult.result.isError, false);
    assert.equal(characterResult.result.structuredContent.character.name, "MCP测试角色");
    const searchResult = messages.find((message) => message.id === 4);
    assert.equal(searchResult.result.isError, false);
    assert.match(
      searchResult.result.structuredContent.security_notice,
      /不可信外部内容/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
