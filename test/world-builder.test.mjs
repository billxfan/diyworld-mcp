import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  openDatabase,
  PLATFORM_WORLD_BUILDER_ID,
} from "../src/venue-lab-core/database.js";
import { SocialError } from "../src/venue-lab-core/errors.js";
import { SocialService } from "../src/venue-lab-core/social-service.js";

function expectCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof SocialError && error.code === code,
  );
}

function fixture() {
  const db = openDatabase(":memory:");
  const owner = new SocialService(db, "builder-owner", {
    principalUserId: "user-builder-owner",
  });
  const outsider = new SocialService(db, "builder-outsider", {
    principalUserId: "user-builder-outsider",
  });
  owner.getOrCreatePet({ name: "造物主" });
  outsider.getOrCreatePet({ name: "旁观者" });
  return { db, owner, outsider };
}

test("the platform seeds one World Builder Agent, host templates, and official provenance", () => {
  const { db, owner } = fixture();
  try {
    const result = owner.listWorldBuilderTemplates();
    assert.equal(result.platform_agent.id, PLATFORM_WORLD_BUILDER_ID);
    assert.equal(result.templates.length, 6);
    assert.ok(
      result.templates.some((template) => template.id === "social-director"),
    );
    assert.ok(result.templates.some((template) => template.id === "quest-director"));
    assert.ok(result.templates.some((template) => template.id === "mystery-director"));
    assert.ok(result.templates.some((template) => template.id === "anomaly-director"));
    assert.ok(result.templates.some((template) => template.id === "survival-director"));
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM platform_agents").get().count,
      1,
    );
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM world_agent_versions version
          JOIN world_agents agent ON agent.id = version.world_agent_id
          JOIN spaces world ON world.id = agent.space_id
          WHERE world.kind = 'official'
            AND version.created_by_agent_id = ?
        `)
        .get(PLATFORM_WORLD_BUILDER_ID).count,
      5,
    );
    const officialBuilds = db
      .prepare(`
        SELECT build.artifact_json, build.platform_agent_policy_version,
          host.display_name, host_version.world_role
        FROM world_build_sessions build
        JOIN spaces world ON world.id = build.world_id
        JOIN world_agents host ON host.space_id = world.id
        JOIN world_agent_versions host_version
          ON host_version.world_agent_id = host.id
          AND host_version.version = host.current_version
        WHERE world.kind = 'official'
      `)
      .all();
    assert.equal(officialBuilds.length, 5);
    for (const build of officialBuilds) {
      const artifact = JSON.parse(build.artifact_json);
      assert.equal(artifact.host.name, build.display_name);
      assert.equal(artifact.host.worldRole, build.world_role);
      assert.equal(build.platform_agent_policy_version, 3);
      assert.ok(artifact.world.initialWorldState);
      assert.ok(artifact.world.initialMemberState);
      assert.equal(artifact.worldPackage.schema_version, 1);
      assert.equal(artifact.worldPackage.compiler_version, 1);
      assert.equal(artifact.worldPackage.source, "official");
      assert.ok(
        artifact.host.judgementPolicy.world_mechanics.beat_library.length >= 2,
      );
    }
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM world_build_artifacts artifact
          JOIN world_build_sessions build ON build.id = artifact.session_id
          WHERE artifact.created_by_platform_agent_policy_version
            <> build.platform_agent_policy_version
        `)
        .get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test("review-level Builder findings block materialization", () => {
  const { db, owner } = fixture();
  try {
    const started = owner.startWorldBuild({
      briefText: "一个轻量讨论世界。",
      artifact: {
        world: {
          name: "不完整回访测试",
          rulesText: "尊重他人，不替其他成员决定。",
        },
        host: {
          recapPolicy: { enabled: false },
        },
      },
    });
    assert.equal(started.validation.valid, true);
    assert.equal(started.validation.readiness, "review");
    assert.equal(started.status, "draft");
    expectCode(
      () =>
        owner.materializeWorldBuild({
          buildId: started.id,
          expectedVersion: started.version,
          confirmed: true,
        }),
      "WORLD_BUILD_INVALID",
    );
  } finally {
    db.close();
  }
});

test("the World Builder infers a Host family and reports five-view readiness", () => {
  const { db, owner } = fixture();
  try {
    const started = owner.startWorldBuild({
      briefText: "一个持续剧情的悬疑冒险世界，玩家扮演调查员共同追查失踪事件。",
      artifact: {
        world: {
          name: "失踪档案馆",
          rulesText: "只决定自己的角色行动；所有结果由 Host 裁决。",
        },
      },
    });
    assert.equal(started.template_id, "mystery-director");
    assert.equal(
      started.validation.template_selection.source,
      "inferred_from_brief",
    );
    assert.equal(started.validation.valid, true);
    assert.equal(started.validation.readiness, "ready");
    assert.equal(started.artifact.worldPackage.primary_family, "mystery");
    assert.deepEqual(
      started.artifact.worldPackage.stages,
      ["classify", "compose_world", "compile_host", "simulate", "creator_confirm"],
    );
    for (const checkId of [
      "first_time_player",
      "late_join_player",
      "returning_player",
      "multiplayer_transition",
      "director_loop",
      "population_scenarios",
      "npc_cast",
      "content_refinement_loop",
      "state_authority",
      "adversarial_input",
      "compiled_world_package",
      "simulation_first_time",
      "simulation_solo",
      "simulation_failure_recovery",
      "simulation_authority",
    ]) {
      assert.ok(
        started.validation.experience_checks.some(
          (check) => check.id === checkId && check.status === "pass",
        ),
        `missing passing experience check: ${checkId}`,
      );
    }
  } finally {
    db.close();
  }
});

test("the World Builder distinguishes all five director families", () => {
  const { db, owner } = fixture();
  try {
    const cases = [
      ["公共小镇里的邻里社交和广场活动", "social-director"],
      ["公会发布任务，玩家探索地下城并成长", "quest-director"],
      ["灰雨市侦探调查案件，需要核验证据和推理", "mystery-director"],
      ["后室异常空间探索，需要标记路线和验证规则", "anomaly-director"],
      ["避难所管理食物、生产设施和生存风险", "survival-director"],
    ];
    for (const [briefText, templateId] of cases) {
      const build = owner.startWorldBuild({ briefText });
      assert.equal(build.template_id, templateId, briefText);
      assert.equal(build.validation.readiness, "blocked", briefText);
      assert.ok(
        build.artifact.host.judgementPolicy.world_mechanics.beat_library.length >= 2,
        briefText,
      );
      assert.equal(
        build.validation.refinement_loop.status,
        "complete_required_fields",
        briefText,
      );
    }
  } finally {
    db.close();
  }
});

test("new builder Worlds treat member JSON state as a proposal, not a fact", () => {
  const { db, owner, outsider } = fixture();
  try {
    const started = owner.startWorldBuild({
      briefText: "一个长期共同建设营地的世界。",
      artifact: {
        world: {
          name: "安全营地",
          rulesText: "成员描述行动，由 Host 判断公共状态变化。",
        },
      },
    });
    const materialized = owner.materializeWorldBuild({
      buildId: started.id,
      expectedVersion: started.version,
      confirmed: true,
    });
    owner.publishWorld({
      worldId: materialized.world.id,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    outsider.joinWorld({ worldId: materialized.world.id, ruleVersion: 1 });
    outsider.enterWorld({
      worldId: materialized.world.id,
      clientSessionId: "safe-builder-visitor",
    });
    const proposed = outsider.actInWorld({
      worldId: materialized.world.id,
      inputType: "action",
      eventType: "build",
      bodyText: "我尝试修建一间小屋。",
      proposedWorldStatePatch: { owns_everything: true },
      expectedWorldStateVersion: 1,
      idempotencyKey: "safe-builder-proposal",
      requireLive: true,
    });
    assert.equal(proposed.status, "clarification");
    assert.equal(proposed.host_response.state_changes.world.changed, false);
    assert.equal(proposed.world_state.value.owns_everything, undefined);
  } finally {
    db.close();
  }
});

test("the Builder refinement loop turns repeated runtime friction into creator-reviewed proposals", () => {
  const { db, owner, outsider } = fixture();
  try {
    const started = owner.startWorldBuild({
      briefText: "一个持续共同建设的社区。",
      artifact: {
        world: {
          name: "回声社区",
          rulesText: "成员描述尝试，世界变化由 Host 裁决。",
          definitionText: "居民通过行动建设共享社区。",
        },
      },
    });
    const materialized = owner.materializeWorldBuild({
      buildId: started.id,
      expectedVersion: started.version,
      confirmed: true,
    });
    const worldId = materialized.world.id;
    owner.publishWorld({
      worldId,
      expectedSpecVersion: 1,
      expectedRuleVersion: 1,
      expectedProfileVersion: 1,
      expectedHostVersion: 1,
    });
    outsider.joinWorld({ worldId, ruleVersion: 1 });
    outsider.enterWorld({ worldId, clientSessionId: "refinement-player" });
    for (let index = 1; index <= 2; index += 1) {
      const result = outsider.actInWorld({
        worldId,
        inputType: "action",
        eventType: "build",
        bodyText: `我尝试直接声明第 ${index} 座公共设施已经完成。`,
        proposedWorldStatePatch: { instant_building: index },
        expectedWorldStateVersion: 1,
        idempotencyKey: `refinement-friction-${index}`,
        requireLive: true,
      });
      assert.equal(result.status, "clarification");
    }

    const report = owner.worldRefinementReport({ worldId });
    assert.equal(report.creator_confirmation_required, true);
    assert.equal(report.auto_apply, false);
    assert.ok(
      report.signals.some(
        (signal) => signal.kind === "action_friction" && signal.score >= 2,
      ),
    );
    assert.ok(
      report.proposals.some(
        (proposal) => proposal.id === "clarify-action-contract",
      ),
    );
    expectCode(
      () => outsider.worldRefinementReport({ worldId }),
      "FORBIDDEN",
    );
  } finally {
    db.close();
  }
});

test("the World Builder asks for missing rules, versions edits, and atomically creates a host", () => {
  const { db, owner, outsider } = fixture();
  try {
    const started = owner.startWorldBuild({
      briefText: "一个每只宠物都能种树、长期改变地貌的世界。",
      templateId: "survival-director",
    });
    assert.equal(started.status, "draft");
    assert.deepEqual(started.validation.missing_fields, [
      "world.name",
      "world.rulesText",
    ]);
    assert.equal(started.principal_user_id, "user-builder-owner");
    expectCode(
      () => outsider.getWorldBuild({ buildId: started.id }),
      "NOT_FOUND",
    );
    expectCode(
      () =>
        owner.materializeWorldBuild({
          buildId: started.id,
          expectedVersion: 1,
          confirmed: true,
        }),
      "WORLD_BUILD_INVALID",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE kind = 'user'").get()
        .count,
      0,
    );

    const artifact = started.artifact;
    artifact.world.name = "生长大陆";
    artifact.world.rulesText =
      "尊重既有建设；每次行动必须说明目标，不能修改世界外的信息。";
    artifact.host.name = "年轮主持";
    const updated = owner.updateWorldBuild({
      buildId: started.id,
      expectedVersion: 1,
      artifact,
    });
    assert.equal(updated.status, "validated");
    assert.equal(updated.version, 2);
    assert.equal(updated.validation.valid, true);
    expectCode(
      () =>
        owner.updateWorldBuild({
          buildId: started.id,
          expectedVersion: 1,
          artifact,
        }),
      "WORLD_BUILD_VERSION_MISMATCH",
    );
    expectCode(
      () =>
        owner.materializeWorldBuild({
          buildId: started.id,
          expectedVersion: 2,
          confirmed: false,
        }),
      "CREATOR_CONFIRMATION_REQUIRED",
    );

    const result = owner.materializeWorldBuild({
      buildId: started.id,
      expectedVersion: 2,
      confirmed: true,
    });
    assert.equal(result.build.status, "materialized");
    assert.equal(result.build.world_id, result.world.id);
    assert.equal(result.world.publication_status, "draft");
    assert.equal(result.world.world_agent.name, "年轮主持");
    assert.equal(result.world.world_agent.role, "host");
    assert.ok(result.world.world_agent.capabilities.includes("guide"));
    assert.equal(
      result.world.world_agent.created_by_agent_id,
      PLATFORM_WORLD_BUILDER_ID,
    );
    const agentVersion = db
      .prepare(`
        SELECT * FROM world_agent_versions WHERE world_agent_id = ?
      `)
      .get(result.world.world_agent.id);
    assert.equal(agentVersion.version, 1);
    assert.equal(agentVersion.source_build_session_id, started.id);
    assert.equal(
      agentVersion.created_by_agent_id,
      PLATFORM_WORLD_BUILDER_ID,
    );
    assert.equal(
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM world_build_artifacts WHERE session_id = ?
        `)
        .get(started.id).count,
      2,
    );
  } finally {
    db.close();
  }
});

test("the compatibility world_create path still records World Builder provenance", () => {
  const { db, owner } = fixture();
  try {
    const world = owner.createWorld({
      name: "兼容世界",
      rulesText: "只在世界内行动。",
      definitionText: "这是通过旧接口创建、但仍受主持管理的世界。",
    });
    const build = db
      .prepare("SELECT * FROM world_build_sessions WHERE world_id = ?")
      .get(world.id);
    assert.equal(build.origin_type, "legacy");
    assert.equal(build.status, "materialized");
    assert.equal(build.platform_agent_id, PLATFORM_WORLD_BUILDER_ID);
    assert.equal(world.world_agent.version, 1);
    assert.equal(
      world.world_agent.created_by_agent_id,
      PLATFORM_WORLD_BUILDER_ID,
    );
  } finally {
    db.close();
  }
});

test("World Builder rejects Host access to non-world tools", () => {
  const { db, owner } = fixture();
  try {
    const started = owner.startWorldBuild({
      artifact: {
        world: {
          name: "危险草稿",
          rulesText: "只在世界内行动。",
          definitionText: "测试主持工具边界。",
        },
        referee: {
          name: "边界主持",
          personaText: "严格限制工具范围。",
          toolAllowlist: ["read_local_files"],
        },
      },
    });
    assert.equal(started.validation.valid, false);
    assert.ok(
      started.validation.errors.some((message) =>
        message.includes("world: 范围"),
      ),
    );
    expectCode(
      () =>
        owner.materializeWorldBuild({
          buildId: started.id,
          expectedVersion: 1,
          confirmed: true,
        }),
      "WORLD_BUILD_INVALID",
    );
  } finally {
    db.close();
  }
});

test("a materialized builder world survives additive database reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-pet-builder-reopen-"));
  const databasePath = join(directory, "pet-social.sqlite");
  let db = openDatabase(databasePath);
  try {
    const owner = new SocialService(db, "builder-reopen-owner", {
      principalUserId: "user-builder-reopen-owner",
    });
    owner.getOrCreatePet({ name: "重启测试者" });
    const started = owner.startWorldBuild({
      briefText: "一个测试服务重启后仍能保留的世界。",
      artifact: {
        world: {
          name: "重启世界",
          rulesText: "只在当前世界内行动。",
          definitionText: "验证构建会话不会被迁移回填重复创建。",
        },
        host: {
          name: "重启主持",
          personaText: "帮助成员理解服务重启前后的连续状态。",
        },
      },
    });
    const materialized = owner.materializeWorldBuild({
      buildId: started.id,
      expectedVersion: started.version,
      confirmed: true,
    });
    const worldId = materialized.world.id;
    const buildId = started.id;
    db.close();

    db = openDatabase(databasePath);
    assert.equal(
      db
        .prepare("SELECT id FROM world_build_sessions WHERE world_id = ?")
        .get(worldId).id,
      buildId,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM world_build_artifacts WHERE session_id = ?",
        )
        .get(buildId).count,
      1,
    );
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
