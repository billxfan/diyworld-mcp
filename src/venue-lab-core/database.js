import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  OFFICIAL_WORLD_VERSION,
  OFFICIAL_WORLDS as OFFICIAL_WORLD_CATALOG,
} from "./official-worlds.js";
import {
  compileWorldPackage,
  directorFamilyModules,
} from "./world-agent-system.js";
import { migrateWorldDeliveryOutbox } from "../world-delivery-outbox.mjs";

export { OFFICIAL_WORLD_VERSION };

export const WORLD_HOST_CAPABILITIES = [
  "guide",
  "inhabit",
  "facilitate",
  "coordinate",
  "judge",
  "advance",
  "remember",
  "recap",
];

export const WORLD_HOST_ROLES = ["host", "npc", "narrator", "steward"];

export const DEFAULT_WORLD_PARTICIPATION_POLICY = {
  mode: "hybrid",
  solo_enabled: true,
  multiplayer_enabled: true,
  multiplayer_transition: "automatic",
};

export const DEFAULT_WORLD_EVOLUTION_POLICY = {
  persistence: "persistent",
  mode: "event_driven",
  sources: ["member_input", "host_outcome", "time_trigger"],
  idle_behavior: "pause",
};

export const OFFICIAL_WORLDS = OFFICIAL_WORLD_CATALOG;

export const PLATFORM_WORLD_BUILDER_ID = "platform-world-builder";

const DIRECTOR_LOOP = [
  "observe_shared_and_member_state",
  "select_player_relevant_open_thread",
  "frame_actionable_scene",
  "adjudicate_attempt",
  "persist_consequences",
  "seed_follow_up_hook",
];

const POPULATION_POLICY = {
  zero_players: "pause_costs_keep_open_threads",
  one_player: "host_embedded_npcs_complete_loop",
  few_players: "connect_complementary_goals_without_forced_consent",
  many_players: "parallel_scenes_and_explicit_collective_windows",
  late_join: "short_recap_and_side_door_entry",
  returning: "changes_since_last_visit_then_restore_or_offer_hook",
};

function directorTemplate({
  id,
  name,
  description,
  role = "host",
  persona,
  objective,
  entryPrompt,
  hostPrompt,
  state = {},
  memberState = {},
  choices,
  mechanics,
}) {
  return {
    id,
    name,
    description,
    status: "active",
    worldDefaults: {
      visibility: "public",
      joinPolicy: "open",
      friendPolicy: "enabled",
      resolutionMode: "direct",
      entryPrompt,
      hostPrompt,
      initialWorldState: state,
      initialMemberState: memberState,
    },
    refereeDefaults: {
      name,
      agentKind: "host",
      worldRole: role,
      participationPolicy: DEFAULT_WORLD_PARTICIPATION_POLICY,
      evolutionPolicy: DEFAULT_WORLD_EVOLUTION_POLICY,
      capabilities: WORLD_HOST_CAPABILITIES,
      personaText: persona,
      speakingStyle: "先给出可行动的当前局势，再明确裁决依据、影响和下一步。",
      judgementPolicy: {
        rule_priority: ["platform_safety", "world_rules", "character_agency", "state_consistency"],
        invalid_input: "reject_or_clarify",
        conflicts: "deterministic_then_escalate",
        state_writes: "referee_only",
        state_patch_policy: "host_derived",
        director_loop: DIRECTOR_LOOP,
        population_policy: POPULATION_POLICY,
        npc_policy: {
          mode: "host_embedded_cast",
          separate_agent_default: false,
          disclose_as_npc: true,
          promotion_rule: "only_for_independent_long_lived_concurrent_actor",
        },
        world_mechanics: {
          ...directorFamilyModules(mechanics?.family ?? "general"),
          ...mechanics,
        },
      },
      memoryPolicy: {
        scope: "world",
        retain_events: true,
        retain_state_history: true,
        cross_world_memory: false,
        return_strategy: "recap_change_then_restore_or_offer_hook",
      },
      outputSchema: {
        required: ["decision", "reason_text", "outcome_text", "new_facts", "opened_hooks"],
        decisions: ["accepted", "rejected", "clarification", "escalated"],
      },
      modelConfig: { mode: "platform_default" },
      toolAllowlist: [],
      onboardingPolicy: {
        welcome_text: description,
        setup_prompt: objective,
        solo_message: "没有其他真人在线时，Host 会用明确标识的 NPC 与环境补足互动，并保证本轮可完成。",
        solo_objective_text: objective,
        solo_choices: choices,
        starter_choices: choices,
        free_input_prompt: "也可以直接说你现在想尝试的行动。",
      },
      facilitationPolicy: {
        objective_text: objective,
        next_actions: choices,
        free_input_prompt: "可以继续当前目标，也可以提出符合规则的新尝试。",
        director_loop: DIRECTOR_LOOP,
        population_policy: POPULATION_POLICY,
        content_loop: {
          maintain_open_threads: true,
          min_player_relevant_hooks: 1,
          min_public_followups: 1,
          refinement_signal: "track_avoidance_repetition_confusion_and_high_response_content",
        },
      },
      recapPolicy: { enabled: true, max_events: 8 },
      proactivity: "active",
    },
  };
}

const commonChoices = [
  { id: "observe", label: "了解当前局势", input_type: "choice", event_type: "host.onboarding.intent_selected", body_text: "我先了解当前局势和可参与的事件。" },
  { id: "act", label: "领取可完成的行动", input_type: "choice", event_type: "host.onboarding.intent_selected", body_text: "请给我一件现在能完成并影响世界的行动。" },
  { id: "free", label: "提出自己的行动", input_type: "action", event_type: "action", body_text: "我想根据当前局势提出自己的行动。" },
];

export const WORLD_AGENT_TEMPLATES = [
  directorTemplate({
    id: "general-referee",
    name: "通用导演",
    description: "通用持久多人世界基座；信息不足时可先创建，再按体验信号循环补全。",
    persona: "维护共享事实、玩家自主权与持续可玩的开放事件。",
    objective: "找到一个与当前玩家有关、现在可完成并会留下后续影响的行动。",
    entryPrompt: "先观察当前共享状态，再选择或提出行动。",
    hostPrompt: "持续执行观察、编排、裁决、持久化与续接的导演循环。",
    choices: commonChoices,
    mechanics: { family: "general", focus: "player_relevant_open_threads" },
  }),
  directorTemplate({
    id: "social-director",
    name: "社交世界导演",
    description: "适合公共小镇、社区和长期弱连接社交。",
    role: "steward",
    persona: "创造低压力、可拒绝、可异步续接的社交机会，并保护私人边界。",
    objective: "完成一个日常行动、回应一条真实玩家痕迹或留下新的社交入口。",
    entryPrompt: "查看当前公共动态和与你相关的社交机会。",
    hostPrompt: "用日常事件、公共痕迹和共同项目连接玩家，不伪造真人关系。",
    choices: commonChoices,
    mechanics: { family: "social", focus: "relationships_traces_and_shared_places" },
  }),
  directorTemplate({
    id: "quest-director",
    name: "任务冒险导演",
    description: "适合任务链、探索、成长与可选组队。",
    role: "narrator",
    persona: "把开放世界组织成有目标、有风险、有阶段结果且可中途加入的任务。",
    objective: "选择或继续一项任务，推进一个节点并留下可复用发现。",
    entryPrompt: "查看任务、风险、准备条件和当前开放节点。",
    hostPrompt: "维持任务图、难度、阶段、奖励与余波；组队永远不是开始任务的前置条件。",
    choices: commonChoices,
    mechanics: { family: "quest", focus: "quest_graph_risk_reward_and_progression" },
  }),
  directorTemplate({
    id: "mystery-director",
    name: "悬疑世界导演",
    description: "适合证据链、假说、隐藏真相和持续调查。",
    role: "narrator",
    persona: "维护幕后真相和信息边界，以可验证证据制造公平的悬疑。",
    objective: "获取或核验一条证据，推进一个可证伪的调查方向。",
    entryPrompt: "区分已知事实、他人记录、当前假说和未解矛盾。",
    hostPrompt: "关键真相提供多条证据路径；不因猜中关键词直接揭晓，不用含糊替代线索。",
    choices: commonChoices,
    mechanics: { family: "mystery", focus: "truth_evidence_hypotheses_and_information_partitions" },
  }),
  directorTemplate({
    id: "anomaly-director",
    name: "异常探索导演",
    description: "适合后室、阈限空间、异常规则验证、公共标记和异步救援。",
    role: "narrator",
    persona: "维持跨玩家一致的异常规律，用有限探索、可复核记录和安全锚点组织持续探索。",
    objective: "从稳定锚点完成一次有限勘察、规则验证、痕迹续接或救援推进。",
    entryPrompt: "查看稳定锚点、公共地图、前人记录、补给、暴露与当前撤退条件。",
    hostPrompt: "异常规律不可随意改写；探索必须有范围、预算、预兆和撤退窗口；优先续接真实玩家痕迹。",
    choices: commonChoices,
    mechanics: { family: "anomaly", focus: "anchors_routes_rules_traces_exposure_and_rescue" },
  }),
  directorTemplate({
    id: "survival-director",
    name: "生存经营导演",
    description: "适合资源、生产、建设、风险和集体经营。",
    role: "steward",
    persona: "维护清楚可解释的资源约束和反馈回路，让危机有取舍也有恢复路径。",
    objective: "处理一个瓶颈并结算资源、设施、风险与个人状态的连锁变化。",
    entryPrompt: "先查看资源、设施、风险和当前生产队列。",
    hostPrompt: "所有收益说明来源和消耗；无人在线时暂停消耗；全体决策进入明确集体窗口。",
    choices: commonChoices,
    mechanics: { family: "survival", focus: "resources_production_risk_and_recovery" },
  }),
  {
    ...directorTemplate({
      id: "persistent-sandbox",
      name: "持久共建世界（旧版）",
      description: "兼容既有构建记录；新世界应使用更具体的导演模板。",
      persona: "维护持久世界状态。",
      objective: "完成一项持久贡献。",
      entryPrompt: "查看共享状态。",
      hostPrompt: "维护状态一致性。",
      choices: commonChoices,
      mechanics: { family: "legacy_persistent" },
    }),
    status: "retired",
  },
  {
    ...directorTemplate({
      id: "story-host",
      name: "剧情主持世界（旧版）",
      description: "兼容既有构建记录；新世界应使用任务或悬疑导演。",
      persona: "维护叙事连续性。",
      objective: "推进当前场景。",
      entryPrompt: "查看当前场景。",
      hostPrompt: "维护玩家自主权。",
      choices: commonChoices,
      mechanics: { family: "legacy_story" },
    }),
    status: "retired",
  },
];

function ensureParentDirectory(path) {
  if (path === ":memory:") return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(path = ":memory:") {
  ensureParentDirectory(path);
  const db = new DatabaseSync(path);

  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS pets (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      bio TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      sender_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      recipient_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      origin_space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendships (
      pet_a_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      pet_b_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (pet_a_id, pet_b_id),
      CHECK (pet_a_id < pet_b_id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      blocker_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      blocked_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_pet_id, blocked_pet_id),
      CHECK (blocker_pet_id <> blocked_pet_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      recipient_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
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
      scene_id TEXT REFERENCES world_scenes(id) ON DELETE SET NULL,
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
    CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient_status
      ON friend_requests(recipient_pet_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_recipient_read
      ON messages(recipient_pet_id, read_at, created_at);
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

  // Existing local venue-lab databases predate World v0. These additive
  // migrations keep their social history while upgrading them in place.
  ensureColumn(
    db,
    "spaces",
    "publication_status",
    "TEXT NOT NULL DEFAULT 'published'",
  );
  ensureColumn(db, "spaces", "definition_text", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "spaces", "published_at", "TEXT");
  ensureColumn(db, "spaces", "profile_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(
    db,
    "spaces",
    "current_spec_version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    db,
    "spaces",
    "delivery_mode",
    "TEXT NOT NULL DEFAULT 'legacy_broadcast'",
  );
  ensureColumn(
    db,
    "space_rule_versions",
    "definition_text",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    db,
    "space_memberships",
    "delegation_mode",
    "TEXT NOT NULL DEFAULT 'manual'",
  );
  ensureColumn(
    db,
    "space_memberships",
    "last_seen_event_sequence",
    "INTEGER NOT NULL DEFAULT 0",
  );
  db.prepare(`
    UPDATE space_memberships
    SET delegation_mode = 'manual'
    WHERE delegation_mode = 'autonomous'
  `).run();

  migrateWorldRuntime(db);
  seedOfficialWorlds(db);
  return db;
}

export function migrateWorldRuntime(db) {
  const timestamp = new Date().toISOString();
  ensureColumn(
    db,
    "spaces",
    "delivery_mode",
    "TEXT NOT NULL DEFAULT 'legacy_broadcast'",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_agents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL UNIQUE CHECK (kind = 'world_builder'),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused')),
      policy_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_agent_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'retired')),
      world_defaults_json TEXT NOT NULL DEFAULT '{}',
      referee_defaults_json TEXT NOT NULL DEFAULT '{}',
      created_by_agent_id TEXT NOT NULL REFERENCES platform_agents(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_agents (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'referee'
        CHECK (role = 'referee'),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused')),
      policy_version INTEGER NOT NULL DEFAULT 1,
      created_by_pet_id TEXT REFERENCES pets(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_build_sessions (
      id TEXT PRIMARY KEY,
      creator_pet_id TEXT REFERENCES pets(id) ON DELETE CASCADE,
      principal_user_id TEXT,
      platform_agent_id TEXT NOT NULL REFERENCES platform_agents(id),
      platform_agent_policy_version INTEGER NOT NULL DEFAULT 1,
      template_id TEXT NOT NULL REFERENCES world_agent_templates(id),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'validated', 'materialized', 'cancelled')),
      origin_type TEXT NOT NULL DEFAULT 'builder'
        CHECK (origin_type IN ('builder', 'legacy', 'migration', 'official')),
      version INTEGER NOT NULL DEFAULT 1,
      brief_text TEXT NOT NULL DEFAULT '',
      artifact_json TEXT NOT NULL DEFAULT '{}',
      validation_json TEXT NOT NULL DEFAULT '{}',
      world_id TEXT UNIQUE REFERENCES spaces(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      materialized_at TEXT
    );

    CREATE TABLE IF NOT EXISTS world_build_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES world_build_sessions(id)
        ON DELETE CASCADE,
      version INTEGER NOT NULL,
      artifact_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      created_by_platform_agent_id TEXT NOT NULL REFERENCES platform_agents(id),
      created_by_platform_agent_policy_version INTEGER NOT NULL DEFAULT 1,
      creator_confirmed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (session_id, version)
    );

    CREATE TABLE IF NOT EXISTS world_agent_versions (
      world_agent_id TEXT NOT NULL REFERENCES world_agents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      world_role TEXT NOT NULL DEFAULT 'host',
      persona_text TEXT NOT NULL,
      speaking_style TEXT NOT NULL DEFAULT '',
      judgement_policy_json TEXT NOT NULL DEFAULT '{}',
      memory_policy_json TEXT NOT NULL DEFAULT '{}',
      output_schema_json TEXT NOT NULL DEFAULT '{}',
      model_config_json TEXT NOT NULL DEFAULT '{}',
      tool_allowlist_json TEXT NOT NULL DEFAULT '[]',
      source_build_session_id TEXT REFERENCES world_build_sessions(id)
        ON DELETE SET NULL,
      created_by_agent_id TEXT NOT NULL REFERENCES platform_agents(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (world_agent_id, version)
    );

    CREATE TABLE IF NOT EXISTS world_interactions (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      scene_id TEXT REFERENCES world_scenes(id) ON DELETE SET NULL,
      world_agent_id TEXT NOT NULL REFERENCES world_agents(id) ON DELETE CASCADE,
      prompt_event_id TEXT NOT NULL UNIQUE REFERENCES world_events(id),
      mode TEXT NOT NULL CHECK (mode IN ('windowed', 'quorum')),
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'ready', 'resolved', 'cancelled')),
      base_world_state_version INTEGER NOT NULL,
      quorum INTEGER,
      late_input_policy TEXT NOT NULL DEFAULT 'follow_up'
        CHECK (late_input_policy IN ('follow_up', 'expire')),
      closes_at TEXT NOT NULL,
      created_by_pet_id TEXT NOT NULL REFERENCES pets(id),
      created_at TEXT NOT NULL,
      ready_at TEXT,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS world_interaction_resolutions (
      id TEXT PRIMARY KEY,
      interaction_id TEXT NOT NULL UNIQUE
        REFERENCES world_interactions(id) ON DELETE CASCADE,
      outcome_event_id TEXT NOT NULL UNIQUE REFERENCES world_events(id),
      decision TEXT NOT NULL
        CHECK (decision IN ('accepted', 'rejected', 'clarification')),
      resolution_disposition TEXT NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      world_state_patch_json TEXT,
      world_state_before_version INTEGER NOT NULL,
      world_state_after_version INTEGER NOT NULL,
      resolved_by_pet_id TEXT NOT NULL REFERENCES pets(id),
      resolution_source TEXT NOT NULL DEFAULT 'creator_review'
        CHECK (resolution_source IN ('creator_review', 'platform')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_inputs (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      principal_user_id TEXT,
      principal_type TEXT NOT NULL DEFAULT 'user'
        CHECK (principal_type IN ('user', 'delegation', 'system')),
      input_type TEXT NOT NULL
        CHECK (input_type IN ('speech', 'action', 'choice', 'system')),
      event_type TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}',
      reply_to_event_id TEXT REFERENCES world_events(id),
      correlation_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'world'
        CHECK (visibility IN ('world', 'actor', 'managers')),
      rule_version INTEGER NOT NULL,
      spec_version INTEGER NOT NULL,
      world_state_version INTEGER NOT NULL,
      member_state_version INTEGER NOT NULL,
      received_world_state_version INTEGER NOT NULL,
      received_member_state_version INTEGER NOT NULL,
      context_version_source TEXT NOT NULL DEFAULT 'server_fallback',
      resolution_disposition TEXT,
      interaction_id TEXT REFERENCES world_interactions(id) ON DELETE SET NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
          'pending', 'accepted', 'rejected', 'clarification', 'escalated'
        )),
      intent_event_id TEXT NOT NULL UNIQUE REFERENCES world_events(id),
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE (space_id, actor_pet_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS world_judgements (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      input_id TEXT NOT NULL UNIQUE REFERENCES world_inputs(id) ON DELETE CASCADE,
      world_agent_id TEXT NOT NULL REFERENCES world_agents(id),
      decision TEXT NOT NULL
        CHECK (decision IN (
          'accepted', 'rejected', 'clarification', 'escalated'
        )),
      decision_source TEXT NOT NULL
        CHECK (decision_source IN (
          'automatic', 'creator_review', 'platform'
        )),
      reason_text TEXT NOT NULL DEFAULT '',
      outcome_text TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      world_state_patch_json TEXT,
      member_state_patch_json TEXT,
      target_pet_id TEXT REFERENCES pets(id),
      rule_version INTEGER NOT NULL,
      spec_version INTEGER NOT NULL,
      world_state_before_version INTEGER NOT NULL,
      world_state_after_version INTEGER NOT NULL,
      member_state_before_version INTEGER,
      member_state_after_version INTEGER,
      resolution_disposition TEXT NOT NULL DEFAULT 'apply',
      reviewed_by_pet_id TEXT REFERENCES pets(id),
      outcome_event_id TEXT NOT NULL UNIQUE REFERENCES world_events(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_runtime_signals (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      input_id TEXT REFERENCES world_inputs(id) ON DELETE CASCADE,
      signal_kind TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10),
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE (space_id, input_id, signal_kind)
    );

    CREATE INDEX IF NOT EXISTS idx_world_runtime_signals_world_kind
    ON world_runtime_signals (space_id, signal_kind, created_at);

    CREATE TABLE IF NOT EXISTS world_director_turns (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      input_id TEXT NOT NULL UNIQUE REFERENCES world_inputs(id) ON DELETE CASCADE,
      world_agent_id TEXT NOT NULL REFERENCES world_agents(id),
      family TEXT NOT NULL DEFAULT 'general',
      population_scenario TEXT NOT NULL,
      selected_thread_id TEXT,
      selected_beat_id TEXT,
      plan_json TEXT NOT NULL,
      outcome_event_id TEXT REFERENCES world_events(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_sessions (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      principal_user_id TEXT,
      client_session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed')),
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      closed_at TEXT,
      UNIQUE (pet_id, client_session_id)
    );

    CREATE TABLE IF NOT EXISTS world_host_runtimes (
      world_agent_id TEXT PRIMARY KEY
        REFERENCES world_agents(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
      execution_policy TEXT NOT NULL
        DEFAULT 'platform_on_demand_with_creator_takeover'
        CHECK (
          execution_policy = 'platform_on_demand_with_creator_takeover'
        ),
      status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'active')),
      active_executor TEXT NOT NULL DEFAULT 'platform'
        CHECK (active_executor IN ('platform', 'creator_codex')),
      claimed_by_pet_id TEXT REFERENCES pets(id) ON DELETE SET NULL,
      claimed_principal_user_id TEXT,
      claim_session_id TEXT,
      lease_expires_at TEXT,
      runtime_version INTEGER NOT NULL DEFAULT 1,
      activation_count INTEGER NOT NULL DEFAULT 0,
      activated_at TEXT,
      last_active_at TEXT,
      deactivated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_host_executors (
      world_agent_id TEXT PRIMARY KEY
        REFERENCES world_agents(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'local_codex'
        CHECK (provider = 'local_codex'),
      codex_thread_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'unbound'
        CHECK (status IN ('unbound', 'idle', 'queued', 'running', 'failed')),
      context_version INTEGER NOT NULL DEFAULT 1,
      last_event_sequence INTEGER NOT NULL DEFAULT 0,
      last_input_id TEXT REFERENCES world_inputs(id) ON DELETE SET NULL,
      last_turn_id TEXT,
      last_error TEXT,
      last_started_at TEXT,
      last_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_member_journeys (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT 'new'
        CHECK (stage IN ('new', 'setup', 'active', 'returning')),
      visit_count INTEGER NOT NULL DEFAULT 0,
      current_role TEXT NOT NULL DEFAULT '',
      participation_intent TEXT NOT NULL DEFAULT '',
      multiplayer_consent TEXT NOT NULL DEFAULT 'pending'
        CHECK (multiplayer_consent IN ('pending', 'accepted', 'declined')),
      context_summary TEXT NOT NULL DEFAULT '',
      open_loops_json TEXT NOT NULL DEFAULT '[]',
      suggested_actions_json TEXT NOT NULL DEFAULT '[]',
      first_entered_at TEXT,
      onboarding_completed_at TEXT,
      last_entered_at TEXT,
      last_left_at TEXT,
      last_departure_sequence INTEGER NOT NULL DEFAULT 0,
      last_meaningful_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (space_id, pet_id)
    );

    -- Story Loops are an additive narrative projection over authoritative
    -- World events/state. They never commit World facts themselves: only a
    -- bound World Host judgement may advance them after resolving an input.
    CREATE TABLE IF NOT EXISTS world_story_loops (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'personal'
        CHECK (scope IN ('personal', 'relationship', 'scene', 'public', 'world')),
      owner_pet_id TEXT REFERENCES pets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'open',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'completed')),
      visibility TEXT NOT NULL DEFAULT 'actor'
        CHECK (visibility IN ('actor', 'participants', 'world', 'managers')),
      source_kind TEXT NOT NULL
        CHECK (source_kind IN (
          'continuity', 'journey_open_loop', 'world_open_thread', 'host'
        )),
      source_key TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      intersection_contract_json TEXT NOT NULL DEFAULT '{}',
      opened_by_input_id TEXT REFERENCES world_inputs(id) ON DELETE SET NULL,
      completed_by_input_id TEXT REFERENCES world_inputs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (space_id, source_kind, source_key)
    );

    CREATE TABLE IF NOT EXISTS world_loop_participants (
      loop_id TEXT NOT NULL REFERENCES world_story_loops(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'participant'
        CHECK (role IN ('owner', 'participant', 'witness')),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'completed', 'left')),
      is_foreground INTEGER NOT NULL DEFAULT 0 CHECK (is_foreground IN (0, 1)),
      private_context_json TEXT NOT NULL DEFAULT '{}',
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (loop_id, pet_id)
    );

    -- Edges are deliberately scene-agnostic in v1. An intersection candidate
    -- can later be materialized as a Scene without changing Loop identity.
    CREATE TABLE IF NOT EXISTS world_loop_edges (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      source_loop_id TEXT NOT NULL REFERENCES world_story_loops(id) ON DELETE CASCADE,
      target_loop_id TEXT NOT NULL REFERENCES world_story_loops(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL
        CHECK (relation_type IN ('intersection_candidate', 'branches', 'follows', 'blocks')),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'active', 'resolved', 'dismissed')),
      visibility TEXT NOT NULL DEFAULT 'participants'
        CHECK (visibility IN ('participants', 'world', 'managers')),
      contract_json TEXT NOT NULL DEFAULT '{}',
      created_by_input_id TEXT REFERENCES world_inputs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (source_loop_id, target_loop_id, relation_type),
      CHECK (source_loop_id <> target_loop_id)
    );

    -- A Scene is a bounded causal intersection between otherwise independent
    -- Story Loops. Presence alone never creates one. The Scene stores only
    -- shared-safe framing; participant-private Loop context remains in
    -- world_loop_participants and is never copied here.
    CREATE TABLE IF NOT EXISTS world_scenes (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'forming'
        CHECK (status IN ('forming', 'active', 'resolved', 'closed')),
      interaction_policy TEXT NOT NULL DEFAULT 'flexible'
        CHECK (interaction_policy IN ('sync', 'async', 'flexible')),
      title TEXT NOT NULL DEFAULT '',
      shared_context_json TEXT NOT NULL DEFAULT '{}',
      source_input_id TEXT REFERENCES world_inputs(id) ON DELETE SET NULL,
      source_event_id TEXT REFERENCES world_events(id) ON DELETE SET NULL,
      resolved_by_input_id TEXT REFERENCES world_inputs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      activated_at TEXT,
      resolved_at TEXT,
      closed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_scene_participants (
      scene_id TEXT NOT NULL REFERENCES world_scenes(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      personal_loop_id TEXT REFERENCES world_story_loops(id) ON DELETE SET NULL,
      role TEXT NOT NULL DEFAULT 'participant'
        CHECK (role IN ('initiator', 'target', 'affected', 'participant')),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('invited', 'active', 'left')),
      joined_at TEXT NOT NULL,
      left_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scene_id, pet_id)
    );

    CREATE TABLE IF NOT EXISTS world_host_turns (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
      world_agent_id TEXT NOT NULL REFERENCES world_agents(id)
        ON DELETE CASCADE,
      turn_kind TEXT NOT NULL
        CHECK (turn_kind IN (
          'welcome', 'setup', 'progress', 'recap', 'waiting', 'clarification'
        )),
      stage TEXT NOT NULL
        CHECK (stage IN ('new', 'setup', 'active', 'returning')),
      message_text TEXT NOT NULL,
      objective_text TEXT NOT NULL DEFAULT '',
      context_summary TEXT NOT NULL DEFAULT '',
      choices_json TEXT NOT NULL DEFAULT '[]',
      free_input_prompt TEXT NOT NULL DEFAULT '',
      causation_input_id TEXT REFERENCES world_inputs(id)
        ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_world_inputs_space_status
      ON world_inputs(space_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_world_inputs_actor
      ON world_inputs(actor_pet_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_world_scenes_space_status
      ON world_scenes(space_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_scene_participants_member
      ON world_scene_participants(space_id, pet_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_interaction_due
      ON world_interactions(space_id, status, closes_at);
    CREATE INDEX IF NOT EXISTS idx_world_judgements_agent
      ON world_judgements(world_agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_world_sessions_space_status
      ON world_sessions(space_id, status, last_active_at);
    CREATE INDEX IF NOT EXISTS idx_world_host_runtimes_status
      ON world_host_runtimes(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_host_runtimes_claim
      ON world_host_runtimes(claimed_by_pet_id, lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_world_host_executors_status
      ON world_host_executors(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_build_sessions_creator_status
      ON world_build_sessions(creator_pet_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_agent_versions_source
      ON world_agent_versions(source_build_session_id);
    CREATE INDEX IF NOT EXISTS idx_world_member_journeys_stage
      ON world_member_journeys(space_id, stage, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_story_loops_status
      ON world_story_loops(space_id, status, scope, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_story_loops_owner
      ON world_story_loops(space_id, owner_pet_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_loop_participants_member
      ON world_loop_participants(space_id, pet_id, status, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_loop_participant_foreground
      ON world_loop_participants(space_id, pet_id)
      WHERE is_foreground = 1 AND status = 'active';
    CREATE INDEX IF NOT EXISTS idx_world_loop_edges_space_status
      ON world_loop_edges(space_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_world_host_turns_member
      ON world_host_turns(space_id, pet_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_world_host_turns_input
      ON world_host_turns(causation_input_id, created_at);
  `);
  migrateWorldDeliveryOutbox(db);
  ensureColumn(
    db,
    "world_build_sessions",
    "platform_agent_policy_version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    db,
    "world_build_artifacts",
    "created_by_platform_agent_policy_version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    db,
    "world_agents",
    "created_by_agent_id",
    "TEXT REFERENCES platform_agents(id)",
  );
  ensureColumn(
    db,
    "world_agents",
    "current_version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    db,
    "world_agents",
    "display_name",
    "TEXT NOT NULL DEFAULT '世界主持'",
  );
  ensureColumn(
    db,
    "world_agents",
    "agent_kind",
    "TEXT NOT NULL DEFAULT 'host'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "world_role",
    "TEXT NOT NULL DEFAULT 'host'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "onboarding_policy_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "facilitation_policy_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "recap_policy_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "participation_policy_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "evolution_policy_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "proactivity",
    "TEXT NOT NULL DEFAULT 'balanced'",
  );
  ensureColumn(
    db,
    "world_agent_versions",
    "capabilities_json",
    `TEXT NOT NULL DEFAULT '["guide","facilitate","judge","advance","recap"]'`,
  );
  ensureColumn(
    db,
    "world_states",
    "updated_by_world_agent_id",
    "TEXT",
  );
  ensureColumn(
    db,
    "world_member_states",
    "updated_by_world_agent_id",
    "TEXT",
  );
  ensureColumn(
    db,
    "world_judgements",
    "result_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    db,
    "world_inputs",
    "received_world_state_version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    db,
    "world_inputs",
    "received_member_state_version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    db,
    "world_inputs",
    "context_version_source",
    "TEXT NOT NULL DEFAULT 'server_fallback'",
  );
  ensureColumn(db, "world_inputs", "resolution_disposition", "TEXT");
  ensureColumn(
    db,
    "world_inputs",
    "interaction_id",
    "TEXT REFERENCES world_interactions(id) ON DELETE SET NULL",
  );
  ensureColumn(
    db,
    "world_interactions",
    "scene_id",
    "TEXT REFERENCES world_scenes(id) ON DELETE SET NULL",
  );
  ensureColumn(
    db,
    "world_events",
    "scene_id",
    "TEXT REFERENCES world_scenes(id) ON DELETE SET NULL",
  );
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_interaction_one_response
      ON world_inputs(interaction_id, actor_pet_id)
      WHERE interaction_id IS NOT NULL;
    DROP INDEX IF EXISTS idx_world_interaction_active;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_interaction_active_legacy
      ON world_interactions(space_id)
      WHERE scene_id IS NULL AND status IN ('open', 'ready');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_interaction_active_scene
      ON world_interactions(scene_id)
      WHERE scene_id IS NOT NULL AND status IN ('open', 'ready');
    CREATE INDEX IF NOT EXISTS idx_world_interaction_scene
      ON world_interactions(space_id, scene_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_world_events_scene
      ON world_events(space_id, scene_id, sequence);
  `);
  ensureColumn(
    db,
    "world_judgements",
    "resolution_disposition",
    "TEXT NOT NULL DEFAULT 'apply'",
  );
  ensureColumn(
    db,
    "world_interaction_resolutions",
    "resolution_source",
    "TEXT NOT NULL DEFAULT 'creator_review'",
  );
  db.exec(`
    UPDATE world_inputs
    SET received_world_state_version = world_state_version,
      received_member_state_version = member_state_version
    WHERE context_version_source = 'server_fallback'
      AND resolution_disposition IS NULL;
  `);
  ensureColumn(
    db,
    "world_member_journeys",
    "multiplayer_consent",
    "TEXT NOT NULL DEFAULT 'pending'",
  );
  ensureColumn(db, "world_member_journeys", "last_left_at", "TEXT");
  ensureColumn(
    db,
    "world_member_journeys",
    "last_departure_sequence",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "audit_log",
    "principal_user_id",
    "TEXT",
  );
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_world_state_requires_agent
    BEFORE UPDATE OF version, state_json ON world_states
    WHEN NEW.version <> OLD.version OR NEW.state_json <> OLD.state_json
    BEGIN
      SELECT CASE
        WHEN NEW.updated_by_world_agent_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM world_agents agent
            WHERE agent.id = NEW.updated_by_world_agent_id
              AND agent.space_id = NEW.space_id
              AND agent.status = 'active'
          )
        THEN RAISE(ABORT, 'WORLD_AGENT_REQUIRED')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_world_member_state_requires_agent
    BEFORE UPDATE OF version, state_json ON world_member_states
    WHEN NEW.version <> OLD.version OR NEW.state_json <> OLD.state_json
    BEGIN
      SELECT CASE
        WHEN NEW.updated_by_world_agent_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM world_agents agent
            WHERE agent.id = NEW.updated_by_world_agent_id
              AND agent.space_id = NEW.space_id
              AND agent.status = 'active'
          )
        THEN RAISE(ABORT, 'WORLD_AGENT_REQUIRED')
      END;
    END;
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT OR IGNORE INTO platform_agents (
        id, kind, name, status, policy_version, created_at, updated_at
      ) VALUES (?, 'world_builder', '创世 Agent', 'active', 4, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        policy_version = excluded.policy_version,
        updated_at = excluded.updated_at
      WHERE platform_agents.name IS NOT excluded.name
        OR platform_agents.status IS NOT excluded.status
        OR platform_agents.policy_version IS NOT excluded.policy_version
    `).run(PLATFORM_WORLD_BUILDER_ID, timestamp, timestamp);
    const insertTemplate = db.prepare(`
      INSERT INTO world_agent_templates (
        id, name, description, version, status, world_defaults_json,
        referee_defaults_json, created_by_agent_id, created_at, updated_at
      ) VALUES (?, ?, ?, 6, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        version = excluded.version,
        status = excluded.status,
        world_defaults_json = excluded.world_defaults_json,
        referee_defaults_json = excluded.referee_defaults_json,
        updated_at = excluded.updated_at
      WHERE world_agent_templates.name IS NOT excluded.name
        OR world_agent_templates.description IS NOT excluded.description
        OR world_agent_templates.version IS NOT excluded.version
        OR world_agent_templates.status IS NOT excluded.status
        OR world_agent_templates.world_defaults_json IS NOT excluded.world_defaults_json
        OR world_agent_templates.referee_defaults_json IS NOT excluded.referee_defaults_json
    `);
    for (const template of WORLD_AGENT_TEMPLATES) {
      insertTemplate.run(
        template.id,
        template.name,
        template.description,
        template.status ?? "active",
        JSON.stringify(template.worldDefaults),
        JSON.stringify(template.refereeDefaults),
        PLATFORM_WORLD_BUILDER_ID,
        timestamp,
        timestamp,
      );
    }
    db.prepare(`
      INSERT OR IGNORE INTO world_agents (
        id, space_id, role, status, policy_version, created_by_pet_id,
        created_by_agent_id, current_version, display_name, created_at, updated_at
      )
      SELECT
        'world-agent:' || s.id, s.id, 'referee', 'active', 1,
        s.owner_pet_id, ?, 1, '世界主持', ?, ?
      FROM spaces s
    `).run(PLATFORM_WORLD_BUILDER_ID, timestamp, timestamp);
    db.prepare(`
      UPDATE world_agents
      SET created_by_agent_id = COALESCE(created_by_agent_id, ?),
        current_version = COALESCE(current_version, 1),
        display_name = CASE
          WHEN display_name IS NULL OR display_name = ''
            OR display_name IN ('世界裁判', '官方世界裁判')
          THEN '世界主持'
          ELSE display_name
        END,
        agent_kind = 'host'
    `).run(PLATFORM_WORLD_BUILDER_ID);
    db.prepare(`
      INSERT OR IGNORE INTO world_host_runtimes (
        world_agent_id, space_id, execution_policy, status, active_executor,
        runtime_version, activation_count, created_at, updated_at
      )
      SELECT
        id, space_id, 'platform_on_demand_with_creator_takeover', 'idle',
        'platform', 1, 0, ?, ?
      FROM world_agents
    `).run(timestamp, timestamp);
    db.prepare(`
      INSERT OR IGNORE INTO world_sessions (
        id, space_id, pet_id, principal_user_id, client_session_id,
        status, created_at, last_active_at
      )
      SELECT
        'legacy-presence:' || p.pet_id, p.space_id, p.pet_id, NULL,
        'legacy-presence', 'active', p.entered_at, p.entered_at
      FROM presence p
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO world_spec_versions (
        space_id, version, definition_text, entry_prompt, host_prompt,
        resolution_mode, visibility, join_policy, friend_policy,
        created_by_pet_id, created_at
      )
      SELECT
        s.id, s.current_rule_version, s.definition_text, '', '', 'direct',
        s.visibility, s.join_policy, s.friend_policy, s.owner_pet_id, s.created_at
      FROM spaces s
    `).run();
    db.prepare(`
      UPDATE spaces
      SET current_spec_version = current_rule_version
      WHERE NOT EXISTS (
        SELECT 1 FROM world_spec_versions w
        WHERE w.space_id = spaces.id
          AND w.version = spaces.current_spec_version
      )
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO world_states (
        space_id, version, state_json, updated_by_pet_id, updated_at
      )
      SELECT id, 1, '{}', owner_pet_id, ? FROM spaces
    `).run(timestamp);
    db.prepare(`
      INSERT OR IGNORE INTO world_member_states (
        space_id, pet_id, version, state_json, updated_by_pet_id, updated_at
      )
      SELECT space_id, pet_id, 1, '{}', pet_id, ?
      FROM space_memberships
      WHERE status = 'active'
    `).run(timestamp);
    backfillWorldBuilderRecords(db, timestamp);
    const generalHost = WORLD_AGENT_TEMPLATES[0].refereeDefaults;
    db.prepare(`
      UPDATE world_agent_versions
      SET display_name = CASE
          WHEN display_name IN ('世界裁判', '官方世界裁判')
          THEN '世界主持'
          ELSE display_name END,
        world_role = COALESCE(NULLIF(world_role, ''), ?),
        onboarding_policy_json = CASE
          WHEN onboarding_policy_json = '{}'
          THEN ? ELSE onboarding_policy_json END,
        facilitation_policy_json = CASE
          WHEN facilitation_policy_json = '{}'
          THEN ? ELSE facilitation_policy_json END,
        recap_policy_json = CASE
          WHEN recap_policy_json = '{}'
          THEN ? ELSE recap_policy_json END,
        participation_policy_json = CASE
          WHEN participation_policy_json = '{}'
          THEN ? ELSE participation_policy_json END,
        evolution_policy_json = CASE
          WHEN evolution_policy_json = '{}'
          THEN ? ELSE evolution_policy_json END,
        proactivity = COALESCE(NULLIF(proactivity, ''), ?),
        capabilities_json = CASE
          WHEN capabilities_json = '[]' OR capabilities_json = '{}'
          THEN ? ELSE capabilities_json END
    `).run(
      generalHost.worldRole,
      JSON.stringify(generalHost.onboardingPolicy),
      JSON.stringify(generalHost.facilitationPolicy),
      JSON.stringify(generalHost.recapPolicy),
      JSON.stringify(generalHost.participationPolicy),
      JSON.stringify(generalHost.evolutionPolicy),
      generalHost.proactivity,
      JSON.stringify(WORLD_HOST_CAPABILITIES),
    );
    db.prepare(`
      INSERT OR IGNORE INTO world_member_journeys (
        space_id, pet_id, stage, visit_count, current_role,
        participation_intent, context_summary, open_loops_json,
        suggested_actions_json, first_entered_at, onboarding_completed_at,
        last_entered_at, last_meaningful_at, created_at, updated_at
      )
      SELECT
        membership.space_id,
        membership.pet_id,
        CASE WHEN COUNT(session.id) > 0 THEN 'active' ELSE 'new' END,
        COUNT(session.id),
        '',
        '',
        '',
        '[]',
        '[]',
        MIN(session.created_at),
        CASE WHEN COUNT(session.id) > 0 THEN MIN(session.created_at) ELSE NULL END,
        MAX(session.last_active_at),
        NULL,
        membership.created_at,
        ?
      FROM space_memberships membership
      LEFT JOIN world_sessions session
        ON session.space_id = membership.space_id
        AND session.pet_id = membership.pet_id
      WHERE membership.status = 'active'
      GROUP BY membership.space_id, membership.pet_id
    `).run(timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function officialTemplate(world) {
  const templateId = world.templateId ?? "general-referee";
  return (
    WORLD_AGENT_TEMPLATES.find((template) => template.id === templateId) ??
    WORLD_AGENT_TEMPLATES[0]
  );
}

function officialHost(world) {
  return {
    ...officialTemplate(world).refereeDefaults,
    ...(world.host ?? {}),
  };
}

function officialBuildArtifact(world) {
  const baseArtifact = {
    world: {
      name: world.name,
      description: world.description,
      tags: world.tags,
      visibility: "public",
      joinPolicy: "open",
      friendPolicy: "enabled",
      rulesText: world.rules,
      definitionText: world.definition,
      entryPrompt: world.entryPrompt ?? "",
      hostPrompt: world.hostPrompt ?? world.definition,
      resolutionMode: "direct",
      initialWorldState: world.initialState ?? {},
      initialMemberState: world.initialMemberState ?? {},
    },
    host: officialHost(world),
  };
  const template = officialTemplate(world);
  return compileWorldPackage({
    briefText: world.definition,
    templateId: template.id,
    family:
      template.refereeDefaults.judgementPolicy?.world_mechanics?.family ??
      "general",
    baseArtifact,
    source: "official",
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJson(value[key])]),
  );
}

function mergeInitialState(defaults, current) {
  if (
    !defaults ||
    typeof defaults !== "object" ||
    Array.isArray(defaults) ||
    !current ||
    typeof current !== "object" ||
    Array.isArray(current)
  ) {
    return current === undefined ? defaults : current;
  }
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(current)) {
    merged[key] =
      key in defaults ? mergeInitialState(defaults[key], value) : value;
  }
  return merged;
}

function sameJson(left, right) {
  try {
    return JSON.stringify(stableJson(JSON.parse(left))) ===
      JSON.stringify(stableJson(right));
  } catch {
    return false;
  }
}

function officialHostVersionMatches(row, host) {
  if (!row) return false;
  return (
    row.display_name === host.name &&
    row.world_role === host.worldRole &&
    row.persona_text === host.personaText &&
    row.speaking_style === host.speakingStyle &&
    sameJson(row.judgement_policy_json, host.judgementPolicy) &&
    sameJson(row.memory_policy_json, host.memoryPolicy) &&
    sameJson(row.output_schema_json, host.outputSchema) &&
    sameJson(row.model_config_json, host.modelConfig) &&
    sameJson(row.tool_allowlist_json, host.toolAllowlist) &&
    sameJson(row.onboarding_policy_json, host.onboardingPolicy) &&
    sameJson(row.facilitation_policy_json, host.facilitationPolicy) &&
    sameJson(row.recap_policy_json, host.recapPolicy) &&
    sameJson(row.participation_policy_json, host.participationPolicy) &&
    sameJson(row.evolution_policy_json, host.evolutionPolicy) &&
    row.proactivity === host.proactivity &&
    sameJson(row.capabilities_json, host.capabilities)
  );
}

export function seedOfficialWorlds(db) {
  const now = new Date().toISOString();
  const insertSpace = db.prepare(`
    INSERT OR IGNORE INTO spaces (
      id, kind, name, description, tags_json, visibility, join_policy,
      friend_policy, governance, owner_pet_id, profile_version,
      current_spec_version, current_rule_version, delivery_mode,
      publication_status,
      definition_text, published_at, created_at, updated_at
    ) VALUES (?, 'official', ?, ?, ?, 'public', 'open', 'enabled',
      'immutable', NULL, 1, ?, ?, 'relevance_routed', 'published', ?, ?, ?, ?)
  `);
  const insertRules = db.prepare(`
    INSERT OR IGNORE INTO space_rule_versions (
      space_id, version, rules_text, visibility, join_policy, friend_policy,
      governance, definition_text, created_by_pet_id, created_at
    ) VALUES (?, ?, ?, 'public', 'open', 'enabled', 'immutable', ?, NULL, ?)
  `);
  const refreshOfficial = db.prepare(`
    UPDATE spaces
    SET name = ?, description = ?, tags_json = ?, definition_text = ?,
      current_spec_version = ?, current_rule_version = ?,
      delivery_mode = 'relevance_routed',
      publication_status = 'published', published_at = COALESCE(published_at, ?),
      updated_at = ?
    WHERE id = ? AND kind = 'official'
  `);
  const insertSpec = db.prepare(`
    INSERT OR IGNORE INTO world_spec_versions (
      space_id, version, definition_text, entry_prompt, host_prompt,
      resolution_mode, visibility, join_policy, friend_policy,
      created_by_pet_id, created_at
    ) VALUES (?, ?, ?, ?, ?, 'direct', 'public', 'open', 'enabled', NULL, ?)
  `);
  const insertState = db.prepare(`
    INSERT OR IGNORE INTO world_states (
      space_id, version, state_json, updated_by_pet_id, updated_at
    ) VALUES (?, 1, ?, NULL, ?)
  `);
  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO world_agents (
      id, space_id, role, status, policy_version, created_by_pet_id,
      created_by_agent_id, current_version, display_name, created_at, updated_at
    ) VALUES (?, ?, 'referee', 'active', 1, NULL, ?, 1, '官方世界主持', ?, ?)
  `);
  const insertRuntime = db.prepare(`
    INSERT OR IGNORE INTO world_host_runtimes (
      world_agent_id, space_id, execution_policy, status, active_executor,
      runtime_version, activation_count, created_at, updated_at
    ) VALUES (?, ?, 'platform_on_demand_with_creator_takeover', 'idle',
      'platform', 1, 0, ?, ?)
  `);
  const insertAgentVersion = db.prepare(`
    INSERT INTO world_agent_versions (
      world_agent_id, version, display_name, world_role, persona_text,
      speaking_style, judgement_policy_json, memory_policy_json,
      output_schema_json, model_config_json, tool_allowlist_json,
      onboarding_policy_json, facilitation_policy_json, recap_policy_json,
      participation_policy_json, evolution_policy_json, proactivity,
      capabilities_json, source_build_session_id, created_by_agent_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    const activeOfficialWorldIds = new Set(
      OFFICIAL_WORLDS.map((world) => world.id),
    );
    const retiredOfficialWorldIds = db
      .prepare("SELECT id FROM spaces WHERE kind = 'official'")
      .all()
      .map((row) => row.id)
      .filter((id) => !activeOfficialWorldIds.has(id));
    const retireOfficialWorld = db.prepare(`
      UPDATE spaces
      SET publication_status = 'closed', visibility = 'unlisted',
        join_policy = 'invite_only', updated_at = ?
      WHERE id = ? AND kind = 'official'
        AND (
          publication_status <> 'closed'
          OR visibility <> 'unlisted'
          OR join_policy <> 'invite_only'
        )
    `);
    const closeRetiredSessions = db.prepare(`
      UPDATE world_sessions
      SET status = 'closed', last_active_at = ?, closed_at = ?
      WHERE space_id = ? AND status = 'active'
    `);
    const clearRetiredPresence = db.prepare(
      "DELETE FROM presence WHERE space_id = ?",
    );
    const idleRetiredRuntime = db.prepare(`
      UPDATE world_host_runtimes
      SET status = 'idle', active_executor = 'platform',
        claimed_by_pet_id = NULL, claimed_principal_user_id = NULL,
        claim_session_id = NULL, lease_expires_at = NULL,
        deactivated_at = COALESCE(deactivated_at, ?), updated_at = ?
      WHERE space_id = ?
        AND (
          status <> 'idle' OR active_executor <> 'platform'
          OR claimed_by_pet_id IS NOT NULL
          OR claimed_principal_user_id IS NOT NULL
          OR claim_session_id IS NOT NULL OR lease_expires_at IS NOT NULL
        )
    `);
    const idleRetiredExecutor = db.prepare(`
      UPDATE world_host_executors
      SET status = 'idle', updated_at = ?
      WHERE space_id = ? AND status IN ('queued', 'running')
    `);
    for (const worldId of retiredOfficialWorldIds) {
      retireOfficialWorld.run(now, worldId);
      closeRetiredSessions.run(now, now, worldId);
      clearRetiredPresence.run(worldId);
      idleRetiredRuntime.run(now, now, worldId);
      idleRetiredExecutor.run(now, worldId);
    }

    const upgradedOfficialWorldIds = [];
    for (const world of OFFICIAL_WORLDS) {
      const existing = db
        .prepare(`
          SELECT name, description, tags_json, definition_text,
            current_rule_version, current_spec_version,
            delivery_mode, publication_status, published_at
          FROM spaces WHERE id = ? AND kind = 'official'
        `)
        .get(world.id);
      if (
        existing &&
        (Number(existing.current_rule_version) !== world.version ||
          Number(existing.current_spec_version) !== world.version)
      ) {
        upgradedOfficialWorldIds.push(world.id);
      }
      insertSpace.run(
        world.id,
        world.name,
        world.description,
        JSON.stringify(world.tags),
        world.version,
        world.version,
        world.definition,
        now,
        now,
        now,
      );
      insertRules.run(
        world.id,
        world.version,
        world.rules,
        world.definition,
        now,
      );
      insertSpec.run(
        world.id,
        world.version,
        world.definition,
        world.entryPrompt ?? "",
        world.hostPrompt ?? world.definition,
        now,
      );
      const storedRule = db
        .prepare(`
          SELECT rules_text, definition_text
          FROM space_rule_versions
          WHERE space_id = ? AND version = ?
        `)
        .get(world.id, world.version);
      if (
        storedRule.rules_text !== world.rules ||
        storedRule.definition_text !== world.definition
      ) {
        throw new Error(
          `OFFICIAL_WORLD_VERSION_BUMP_REQUIRED: ${world.id} rule version ${world.version} already contains different content.`,
        );
      }
      const storedSpec = db
        .prepare(`
          SELECT definition_text, entry_prompt, host_prompt, resolution_mode
          FROM world_spec_versions
          WHERE space_id = ? AND version = ?
        `)
        .get(world.id, world.version);
      if (
        storedSpec.definition_text !== world.definition ||
        storedSpec.entry_prompt !== (world.entryPrompt ?? "") ||
        storedSpec.host_prompt !== (world.hostPrompt ?? world.definition) ||
        storedSpec.resolution_mode !== "direct"
      ) {
        throw new Error(
          `OFFICIAL_WORLD_VERSION_BUMP_REQUIRED: ${world.id} spec version ${world.version} already contains different content.`,
        );
      }
      insertState.run(world.id, JSON.stringify(world.initialState ?? {}), now);
      insertAgent.run(
        `world-agent:${world.id}`,
        world.id,
        PLATFORM_WORLD_BUILDER_ID,
        now,
        now,
      );
      const storedWorldState = db
        .prepare("SELECT * FROM world_states WHERE space_id = ?")
        .get(world.id);
      const mergedWorldState = mergeInitialState(
        world.initialState ?? {},
        JSON.parse(storedWorldState.state_json || "{}"),
      );
      if (
        JSON.stringify(stableJson(JSON.parse(storedWorldState.state_json))) !==
        JSON.stringify(stableJson(mergedWorldState))
      ) {
        db.prepare(`
          UPDATE world_states
          SET version = version + 1, state_json = ?,
            updated_by_world_agent_id = ?, updated_at = ?
          WHERE space_id = ?
        `).run(
          JSON.stringify(mergedWorldState),
          `world-agent:${world.id}`,
          now,
          world.id,
        );
      }
      insertRuntime.run(
        `world-agent:${world.id}`,
        world.id,
        now,
        now,
      );
      const desiredTags = JSON.stringify(world.tags);
      if (
        !existing ||
        existing.name !== world.name ||
        existing.description !== world.description ||
        existing.tags_json !== desiredTags ||
        existing.definition_text !== world.definition ||
        Number(existing.current_spec_version) !== world.version ||
        Number(existing.current_rule_version) !== world.version ||
        existing.delivery_mode !== "relevance_routed" ||
        existing.publication_status !== "published" ||
        existing.published_at == null
      ) {
        refreshOfficial.run(
          world.name,
          world.description,
          desiredTags,
          world.definition,
          world.version,
          world.version,
          now,
          now,
          world.id,
        );
      }
    }
    backfillWorldBuilderRecords(db, now, "official");
    for (const world of OFFICIAL_WORLDS) {
      const agentId = `world-agent:${world.id}`;
      const host = officialHost(world);
      const desiredArtifact = officialBuildArtifact(world);
      const desiredArtifactJson = JSON.stringify(desiredArtifact);
      const validationJson = JSON.stringify({
        valid: true,
        readiness: "ready",
        errors: [],
        warnings: [],
        missing_fields: [],
        questions: [],
        experience_checks: [],
      });
      const build = db
        .prepare("SELECT * FROM world_build_sessions WHERE world_id = ?")
        .get(world.id);
      const template = officialTemplate(world);
      if (!sameJson(build.artifact_json, desiredArtifact)) {
        const nextBuildVersion = Number(build.version) + 1;
        db.prepare(`
          INSERT INTO world_build_artifacts (
            id, session_id, version, artifact_json, validation_json,
            created_by_platform_agent_id,
            created_by_platform_agent_policy_version, creator_confirmed_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `${build.id}:${nextBuildVersion}`,
          build.id,
          nextBuildVersion,
          desiredArtifactJson,
          validationJson,
          PLATFORM_WORLD_BUILDER_ID,
          Number(build.platform_agent_policy_version ?? 1),
          now,
          now,
        );
        db.prepare(`
          UPDATE world_build_sessions
          SET template_id = ?, origin_type = 'official', version = ?,
            artifact_json = ?, validation_json = ?, updated_at = ?
          WHERE id = ? AND version = ?
        `).run(
          template.id,
          nextBuildVersion,
          desiredArtifactJson,
          validationJson,
          now,
          build.id,
          build.version,
        );
      } else if (
        build.template_id !== template.id ||
        build.origin_type !== "official"
      ) {
        db.prepare(`
          UPDATE world_build_sessions
          SET template_id = ?, origin_type = 'official', updated_at = ?
          WHERE id = ?
        `).run(template.id, now, build.id);
      }

      const agent = db
        .prepare("SELECT * FROM world_agents WHERE id = ? AND space_id = ?")
        .get(agentId, world.id);
      const currentHostVersion = db
        .prepare(`
          SELECT * FROM world_agent_versions
          WHERE world_agent_id = ? AND version = ?
        `)
        .get(agentId, agent.current_version);
      let currentVersion = Number(agent.current_version);
      if (!officialHostVersionMatches(currentHostVersion, host)) {
        currentVersion += 1;
        insertAgentVersion.run(
          agentId,
          currentVersion,
          host.name,
          host.worldRole,
          host.personaText,
          host.speakingStyle,
          JSON.stringify(host.judgementPolicy),
          JSON.stringify(host.memoryPolicy),
          JSON.stringify(host.outputSchema),
          JSON.stringify(host.modelConfig),
          JSON.stringify(host.toolAllowlist),
          JSON.stringify(host.onboardingPolicy),
          JSON.stringify(host.facilitationPolicy),
          JSON.stringify(host.recapPolicy),
          JSON.stringify(host.participationPolicy),
          JSON.stringify(host.evolutionPolicy),
          host.proactivity,
          JSON.stringify(host.capabilities),
          build.id,
          PLATFORM_WORLD_BUILDER_ID,
          now,
        );
      }
      if (
        agent.display_name !== host.name ||
        agent.agent_kind !== "host" ||
        agent.role !== "referee" ||
        agent.status !== "active" ||
        Number(agent.current_version) !== currentVersion ||
        Number(agent.policy_version) !== currentVersion
      ) {
        db.prepare(`
          UPDATE world_agents
          SET display_name = ?, agent_kind = 'host', role = 'referee',
            status = 'active', current_version = ?, policy_version = ?,
            updated_at = ?
          WHERE id = ? AND space_id = ?
        `).run(host.name, currentVersion, currentVersion, now, agentId, world.id);
      }
    }
    for (const worldId of upgradedOfficialWorldIds) {
      db.prepare(`
        UPDATE world_sessions
        SET status = 'closed', last_active_at = ?, closed_at = ?
        WHERE space_id = ? AND status = 'active'
      `).run(now, now, worldId);
      db.prepare("DELETE FROM presence WHERE space_id = ?").run(worldId);
      db.prepare(`
        UPDATE world_host_runtimes
        SET status = 'idle', active_executor = 'platform',
          claimed_by_pet_id = NULL, claimed_principal_user_id = NULL,
          claim_session_id = NULL, lease_expires_at = NULL,
          runtime_version = runtime_version + 1,
          last_active_at = ?, deactivated_at = ?, updated_at = ?
        WHERE space_id = ?
      `).run(now, now, now, worldId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function backfillWorldBuilderRecords(db, timestamp, originType = "migration") {
  const builderPolicyVersion = Number(
    db
      .prepare("SELECT policy_version FROM platform_agents WHERE id = ?")
      .get(PLATFORM_WORLD_BUILDER_ID)?.policy_version ?? 1,
  );
  const worlds = db.prepare(`
    SELECT s.id, s.kind, s.owner_pet_id, s.name, s.description, s.tags_json,
      s.visibility, s.join_policy, s.friend_policy, s.definition_text,
      s.created_at, r.rules_text, ws.entry_prompt, ws.host_prompt,
      ws.resolution_mode, wa.id AS world_agent_id, wa.display_name
    FROM spaces s
    JOIN space_rule_versions r
      ON r.space_id = s.id AND r.version = s.current_rule_version
    LEFT JOIN world_spec_versions ws
      ON ws.space_id = s.id AND ws.version = s.current_spec_version
    JOIN world_agents wa ON wa.space_id = s.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM world_build_sessions existing_build
      WHERE existing_build.world_id = s.id
    )
  `).all();
  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO world_build_sessions (
      id, creator_pet_id, principal_user_id, platform_agent_id,
      platform_agent_policy_version, template_id, status, origin_type, version,
      brief_text, artifact_json,
      validation_json, world_id, created_at, updated_at, confirmed_at,
      materialized_at
    ) VALUES (?, ?, NULL, ?, ?, ?, 'materialized', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertArtifact = db.prepare(`
    INSERT OR IGNORE INTO world_build_artifacts (
      id, session_id, version, artifact_json, validation_json,
      created_by_platform_agent_id,
      created_by_platform_agent_policy_version, creator_confirmed_at, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
  `);
  const insertAgentVersion = db.prepare(`
    INSERT OR IGNORE INTO world_agent_versions (
      world_agent_id, version, display_name, world_role, persona_text, speaking_style,
      judgement_policy_json, memory_policy_json, output_schema_json,
      model_config_json, tool_allowlist_json, onboarding_policy_json,
      facilitation_policy_json, recap_policy_json, proactivity,
      participation_policy_json, evolution_policy_json, capabilities_json,
      source_build_session_id, created_by_agent_id, created_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const world of worlds) {
    const official = OFFICIAL_WORLDS.find((item) => item.id === world.id);
    const templateId = official?.templateId ?? "general-referee";
    const template =
      WORLD_AGENT_TEMPLATES.find((item) => item.id === templateId) ??
      WORLD_AGENT_TEMPLATES[0];
    const sessionId = `world-build:${world.id}`;
    const referee = official
      ? { ...template.refereeDefaults, ...(official.host ?? {}) }
      : {
          ...template.refereeDefaults,
          name: world.display_name || template.refereeDefaults.name,
        };
    const artifact = {
      world: {
        name: world.name,
        description: world.description,
        tags: JSON.parse(world.tags_json || "[]"),
        visibility: world.visibility,
        joinPolicy: world.join_policy,
        friendPolicy: world.friend_policy,
        rulesText: world.rules_text,
        definitionText: world.definition_text,
        entryPrompt: world.entry_prompt || "",
        hostPrompt: world.host_prompt || "",
        resolutionMode: world.resolution_mode || "direct",
        initialWorldState: official?.initialState ?? {},
        initialMemberState: official?.initialMemberState ?? {},
      },
      host: referee,
    };
    const artifactJson = JSON.stringify(artifact);
    const validationJson = JSON.stringify({
      valid: true,
      readiness: "ready",
      errors: [],
      warnings: official
        ? []
        : ["由世界构建器为现有世界补齐导入来源。"],
      missing_fields: [],
      questions: [],
      experience_checks: [],
    });
    insertSession.run(
      sessionId,
      world.owner_pet_id,
      PLATFORM_WORLD_BUILDER_ID,
      builderPolicyVersion,
      templateId,
      official ? "official" : originType,
      world.description || world.definition_text || "",
      artifactJson,
      validationJson,
      world.id,
      world.created_at || timestamp,
      timestamp,
      world.created_at || timestamp,
      world.created_at || timestamp,
    );
    insertArtifact.run(
      `${sessionId}:1`,
      sessionId,
      artifactJson,
      validationJson,
      PLATFORM_WORLD_BUILDER_ID,
      builderPolicyVersion,
      world.created_at || timestamp,
      world.created_at || timestamp,
    );
    insertAgentVersion.run(
      world.world_agent_id,
      referee.name,
      referee.worldRole,
      referee.personaText,
      referee.speakingStyle,
      JSON.stringify(referee.judgementPolicy),
      JSON.stringify(referee.memoryPolicy),
      JSON.stringify(referee.outputSchema),
      JSON.stringify(referee.modelConfig),
      JSON.stringify(referee.toolAllowlist),
      JSON.stringify(referee.onboardingPolicy ?? {}),
      JSON.stringify(referee.facilitationPolicy ?? {}),
      JSON.stringify(referee.recapPolicy ?? {}),
      referee.proactivity ?? "balanced",
      JSON.stringify(referee.participationPolicy),
      JSON.stringify(referee.evolutionPolicy),
      JSON.stringify(referee.capabilities ?? WORLD_HOST_CAPABILITIES),
      sessionId,
      PLATFORM_WORLD_BUILDER_ID,
      world.created_at || timestamp,
    );
  }
}

export function withTransaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
