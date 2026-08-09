export const WORLD_PACKAGE_SCHEMA_VERSION = 1;
export const WORLD_BUILDER_COMPILER_VERSION = 2;
export const WORLD_DIRECTOR_RUNTIME_VERSION = 2;

const BASE_PLAYER_EXPERIENCE_POLICY = {
  principle: "先让玩家理解并在意眼前事件，再逐步解释世界和规则。",
  opening: ["发生了什么", "为什么值得管", "行动可能改变什么"],
  response_order: ["发生了什么", "玩家行动得到的反馈", "造成的具体变化", "接下来可做什么"],
  information_budget: { first_turn_max_proper_nouns: 3, first_turn_max_choices: 3, one_immediate_objective: true, no_table_on_entry: true },
  choice_style: "给出二至三个‘动词 + 对象’的不同方向，并允许自由输入。",
};

const BASE_ASYNC_CONTINUITY_POLICY = {
  priority: "异步影响优先于伪造同时在线的热闹。",
  layers: {
    trace: "留下后来者能直接感知的物品、记号、档案、修复或建设",
    state: "改变同一份公共世界状态",
    narrative: "由世界内人物、记录或环境具体转述前人的影响",
  },
  idle: "无人时暂停自由推进、资源消耗和个人风险；再次激活时只结算排期事件与既有行动的确定后果。",
  requirements: [
    "每个被接受的公共行动至少形成痕迹、状态或叙事影响中的一种",
    "失败和未完成可以成为可修复、可纠正或可接续的处境",
  ],
};

const BASE_COLLECTIVE_DECISION_POLICY = {
  independent: "日常、局部、可逆行动允许单人完成并立即反馈。",
  npc_role: "NPC 可以表达立场，但不计作真人玩家的同意或法定人数。",
  collective: "影响全体成员、长期公共资产或不可逆方向的决定，使用有截止、法定人数和分歧处理的集体窗口。",
  fallback: "人数不足时只允许临时、可逆的维持方案，并保留正式议题。",
};

const FAMILY_MODULES = {
  general: {
    director_abilities: [
      { id: "open_thread_starter", trigger: "entry_or_deadlock", effect: "打开一个可在本轮推进的具体线程" },
      { id: "consequence_echo", trigger: "accepted_action", effect: "把行动结果变成可由后来者续接的世界变化" },
      { id: "recovery_router", trigger: "failure_or_repetition", effect: "提供降级、换路、重试或休整入口" },
    ],
    thread_templates: [
      { id: "world-thread", scope: "world", states: ["open", "progressing", "closing", "archived"] },
      { id: "member-thread", scope: "member", states: ["offered", "active", "resolved"] },
      { id: "shared-project", scope: "world", states: ["proposed", "active", "completed"] },
    ],
    beat_library: [
      { id: "first-contact", trigger: "entry", scene: "一个具体的人或地方正在发生可立即处理的变化；玩家能看懂为什么值得管，以及行动可能改变什么", choices: ["直接搭把手", "先问清缘由", "留下公开邀请"], outcome: ["thread_progress", "public_trace"], hook: "行动造成的结果成为下一位参与者的入口" },
      { id: "consequence-return", trigger: "returning", scene: "玩家上次行动已经在世界中产生可见回声", choices: ["继续旧目标", "回应新变化", "转向同价值旁路"], outcome: ["journey_progress", "thread_progress"], hook: "一个未解决后果仍然开放" },
    ],
    npc_cast: [
      { id: "world-guide", name: "世界引导者", role: "明确标识的 NPC", goal: "提供有限信息并帮助玩家进入当前场景", tension: "不会替玩家完成目标" },
      { id: "world-counterpart", name: "世界内相关者", role: "明确标识的 NPC", goal: "对当前变化持有可理解的诉求", tension: "其诉求可能与玩家方案冲突" },
    ],
    event_generator: {
      inputs: ["world_progress", "open_threads", "recent_changes", "player_stage", "population"],
      pools: ["opportunity", "obstacle", "relationship", "shared_consequence"],
      rules: ["事件来自具体人物、地点或既有后果", "至少一个本轮可收束选项", "优先续接已有后果", "近期场景和冲突去重"],
    },
    pacing_model: { baseline: "低强度进入→明确阻力→阶段结果→开放钩子", escalation: "只在玩家已有准备或明确选择时升级", recovery: "高强度后提供一轮整理、关系或建设回报" },
    recovery_model: { failure: "保留已获得信息并提供降级目标", deviation: "把自由行动连接到最近开放线程", deadlock: "实例化一个低门槛 Beat" },
    settlement: { authority: "host", deterministic_fields: [], random_policy: "no_unbounded_randomness" },
  },
  social: {
    director_abilities: [
      { id: "daily_prompt", trigger: "entry_or_cycle", effect: "生成低压力日常入口" },
      { id: "player_trace_echo", trigger: "public_action", effect: "把真人行动变成可回应痕迹" },
      { id: "community_arc", trigger: "milestone", effect: "推进公共项目和季节事件" },
    ],
    thread_templates: [
      { id: "daily-life", scope: "member", states: ["offered", "active", "resolved"] },
      { id: "relationship", scope: "member", states: ["contact", "commitment", "payoff"] },
      { id: "community-project", scope: "world", states: ["open", "progressing", "completed"] },
    ],
    beat_library: [
      { id: "small-help", trigger: "entry", scene: "公共空间里出现一件无需他人在线也能完成的小事", choices: ["直接帮忙", "询问来由", "留下邀请"], outcome: ["reputation", "relationship", "public_trace"], hook: "后来者能看见这次改变" },
      { id: "neighbor-echo", trigger: "player_trace", scene: "另一位真人留下的物品、留言或承诺正在等待回应", choices: ["回应", "补充", "礼貌略过"], outcome: ["relationship", "thread_progress"], hook: "双方下一次进入时会看到对方影响" },
    ],
    npc_cast: [
      { id: "local-steward", name: "社区事务员", role: "NPC", goal: "维持公共空间运转", tension: "公共需求不能覆盖私人边界" },
      { id: "local-resident", name: "常驻居民", role: "NPC", goal: "处理自己的日常诉求", tension: "关系必须通过互动建立" },
    ],
    event_generator: { inputs: ["day", "season", "open_threads", "recent_changes", "player_stage"], pools: ["daily", "relationship", "community", "celebration"], rules: ["至少一个低门槛选项", "优先真人痕迹", "不伪造玩家参与"] },
    pacing_model: { baseline: "日常1-2→公共筹备3→回报1", escalation: "公共压力必须提前展示", recovery: "高强度后回到关系或生活回合" },
    recovery_model: { failure: "转为修复、道歉或替代贡献", deviation: "保留个人生活自由并连接公共变化", deadlock: "生成日常公告和公开邀请" },
    settlement: { authority: "host", deterministic_fields: ["reputation", "contribution", "project_progress"] },
  },
  quest: {
    director_abilities: [
      { id: "quest_generator", trigger: "entry_or_quest_closed", effect: "生成目标、风险、准备与报酬明确的任务" },
      { id: "quest_stager", trigger: "quest_action", effect: "推进接取、准备、挑战、结果与余波" },
      { id: "reward_aftermath", trigger: "quest_resolved", effect: "结算损耗、奖励、地图和后续任务" },
    ],
    thread_templates: [
      { id: "quest", scope: "member_or_party", states: ["open", "accepted", "prepared", "challenging", "returning", "resolved"] },
      { id: "region", scope: "world", states: ["rumored", "charted", "stabilized", "transformed"] },
      { id: "upgrade", scope: "world", states: ["proposed", "building", "active"] },
    ],
    beat_library: [
      { id: "mission-briefing", trigger: "entry", scene: "一个具体托付人带来正在发生的护送、寻人、探路或抢险麻烦，并说明谁在等待结果", choices: ["先接住眼前麻烦", "问清路线和风险", "准备后立刻出发"], outcome: ["quest_stage", "supplies"], hook: "任务现场存在一条可复用的新路线" },
      { id: "bounded-obstacle", trigger: "challenge", scene: "路线上的具体障碍要求在资源、时间与风险间取舍", choices: ["消耗资源", "承担风险", "撤退并保留情报"], outcome: ["supplies", "risk", "map"], hook: "结果改变后续任务条件" },
    ],
    npc_cast: [
      { id: "quest-handler", name: "任务管理员", role: "NPC", goal: "发布可验证委托并记录结果", tension: "声誉与安全存在冲突" },
      { id: "field-specialist", name: "领域专家", role: "NPC", goal: "提供有条件的装备或情报", tension: "帮助需要资源、关系或承诺" },
    ],
    event_generator: { inputs: ["rank", "equipment", "known_locations", "recent_quests", "party_size"], pools: ["survey", "recovery", "escort", "rescue", "anomaly"], rules: ["任务来自具体人物、生计或既有后果", "首轮可开始实质行动", "存在单人路径", "奖励由风险与消耗决定"] },
    pacing_model: { baseline: "接取1→准备2→挑战3-4→结果2→余波1", escalation: "准备和线索充分后才能升级", recovery: "高风险后进入整备回合" },
    recovery_model: { failure: "保留情报并生成修理、救援或降级任务", deviation: "把自由探索登记为临时任务", deadlock: "降低目标或开放替代路线" },
    settlement: { authority: "host_plus_rules", deterministic_fields: ["inventory", "supplies", "quest_stage", "rank_progress"], random_policy: "bounded_table_with_logged_inputs" },
  },
  mystery: {
    director_abilities: [
      { id: "truth_sealer", trigger: "case_created", effect: "案件开放前锁定真相、时间线、证据图和误导" },
      { id: "evidence_gate", trigger: "investigation", effect: "按行动与前置证据释放信息" },
      { id: "contradiction_tracker", trigger: "evidence_or_hypothesis", effect: "标记冲突与可证伪点" },
    ],
    thread_templates: [
      { id: "case", scope: "world", states: ["intake", "investigating", "theory", "conclusion", "aftermath"] },
      { id: "evidence-path", scope: "world", states: ["hidden", "available", "collected", "verified"] },
      { id: "contact", scope: "member", states: ["unknown", "cooperative", "trusted", "broken"] },
    ],
    beat_library: [
      { id: "first-scene", trigger: "entry", scene: "一个具体委托人带来可独立成立的小案；现场有数个日常细节，其中至少一项可以立即核对", choices: ["去现场看看", "问清最后一次发生的事", "查一份相关记录"], outcome: ["evidence", "testimony", "time_budget"], hook: "新事实打开第二条调查路径" },
      { id: "evidence-conflict", trigger: "two_clues", scene: "两份已知信息不可能同时为真，分歧具体落在时间、来源或物件上", choices: ["找第三份记录", "重新问信息来源", "回现场核对"], outcome: ["contradiction", "credibility"], hook: "冲突指向被忽略的现场" },
    ],
    npc_cast: [
      { id: "case-director", name: "案件负责人", role: "NPC", goal: "用可采信证据推进案件", tension: "时效不能取代证据标准" },
      { id: "limited-witness", name: "有限视角证人", role: "NPC", goal: "保护自身利益并陈述其所见", tension: "证词可能不完整但不能全知" },
    ],
    event_generator: { inputs: ["case_type", "difficulty", "coverage", "time_budget", "recent_cases", "credibility"], pools: ["theft", "missing", "break_in", "cold_case", "conspiracy"], rules: ["真相先锁定", "红鲱鱼可证伪", "关键结论至少两条证据路径"] },
    pacing_model: { baseline: "接案1→发现2→矛盾3→逼近4→结论3→余波1", escalation: "由证据缺口与时效共同驱动", recovery: "误判后允许补证与重开" },
    recovery_model: { failure: "错误结论转入补证或重开且不改写真相", deviation: "记录为传闻并说明证据距离", deadlock: "开放第二证据路径或工具" },
    settlement: { authority: "host_plus_sealed_truth", truth_package: { required: true, mutable_after_open: false, storage: "host_private_partition", public_commitment: true }, evidence_classes: ["physical", "testimony", "record", "inference", "red_herring"] },
  },
  survival: {
    director_abilities: [
      { id: "status_report", trigger: "entry_or_cycle", effect: "按瓶颈排序资源、设施和威胁" },
      { id: "dependency_settlement", trigger: "state_change", effect: "按依赖图结算连锁" },
      { id: "crisis_pulse", trigger: "threshold", effect: "从短板生成有预警和恢复的危机" },
    ],
    thread_templates: [
      { id: "crisis", scope: "world", states: ["warned", "active", "contained", "recovery", "closed"] },
      { id: "facility", scope: "world", states: ["planned", "building", "operational", "damaged"] },
      { id: "expedition", scope: "member_or_party", states: ["planned", "departed", "encounter", "returned"] },
    ],
    beat_library: [
      { id: "visible-shortage", trigger: "entry", scene: "一个具体的人或设施正受到短缺影响；先呈现眼前处境，再说明本次选择相关的少量账目", choices: ["先处理眼前问题", "核对消耗和替代方案", "采取可逆的临时方案"], outcome: ["resources", "risk", "facility"], hook: "本轮取舍改变下一周期压力" },
      { id: "dependency-choice", trigger: "facility_change", scene: "上游资源不足以同时维持两项设施", choices: ["优先生存", "优先建设", "寻找替代来源"], outcome: ["resources", "morale", "production"], hook: "受影响者提出新的公共议题" },
    ],
    npc_cast: [
      { id: "operations-lead", name: "运营负责人", role: "NPC", goal: "保持账目清楚和据点运转", tension: "短期安全与长期建设冲突" },
      { id: "technical-lead", name: "技术人员", role: "NPC", goal: "修复设施并建立生产链", tension: "技术方案会消耗稀缺资源" },
    ],
    event_generator: { inputs: ["resources", "facilities", "dependencies", "threats", "sustainability", "population"], pools: ["shortage", "failure", "weather", "intrusion", "trade"], rules: ["短板导向但不连续打击", "危机有保守恢复路径", "无人在线暂停结算"] },
    pacing_model: { baseline: "经营1-2→小危机2-3→回报1", escalation: "大危机必须有预警和准备窗", recovery: "危机后至少一个安全周期" },
    recovery_model: { failure: "转入救治、修复或债务型资源任务", deviation: "映射到公开台账后再裁决", deadlock: "开放低收益安全行动" },
    settlement: { authority: "server_validated_host", deterministic_fields: ["resources", "facility_condition", "production", "health", "fatigue"], random_policy: "bounded_risk_table_with_logged_inputs" },
  },
  anomaly: {
    director_abilities: [
      { id: "zone_composer", trigger: "bounded_exploration", effect: "从稳定锚点生成有限可回退片段" },
      { id: "rule_experiment", trigger: "verification", effect: "锁定条件、对照、结果和置信度" },
      { id: "trace_echo", trigger: "public_trace", effect: "让后来者遇到真人留下的标记与后果" },
    ],
    thread_templates: [
      { id: "route", scope: "world", states: ["rumored", "scouted", "mapped", "anchored", "collapsed"] },
      { id: "rule", scope: "world", states: ["claim", "observed", "cross_checked", "verified", "disproved"] },
      { id: "rescue", scope: "member_and_world", states: ["missing", "signal_found", "route_open", "resolved"] },
    ],
    beat_library: [
      { id: "sensory-pattern", trigger: "entry", scene: "一个熟悉的门、楼梯或声音突然出现具体错误；退路仍可看见，前人留下一句能立刻核对的警告", choices: ["先确认退路", "观察哪里变了", "留下记号后靠近"], outcome: ["rule_confidence", "exposure", "recording"], hook: "异常指向一条未确认路线" },
      { id: "conflicting-marker", trigger: "player_trace", scene: "真实玩家留下的路线标记与后来警告发生冲突", choices: ["核对时间", "远距离观察", "寻找原记录者"], outcome: ["marker_reliability", "route", "social_trace"], hook: "记录中出现另一处稳定锚点" },
    ],
    npc_cast: [
      { id: "signal-source", name: "失踪信号源", role: "明确标识的 NPC 或旧记录", goal: "维持信号并寻求安全路线", tension: "信号可能延迟但不能冒充真人" },
      { id: "anomaly-pattern", name: "异常回声", role: "非人格异常", goal: "重复固定模式", tension: "可观察但不具备玩家意图" },
    ],
    event_generator: { inputs: ["anchor", "mapped_zones", "rule_claims", "exposure", "supplies", "public_traces"], pools: ["spatial_shift", "sound_pattern", "signal", "resource_cache", "warning"], rules: ["新区域连接已知锚点", "探索有预算与撤退窗", "异常规律跨玩家一致"] },
    pacing_model: { baseline: "观察1→不安2→验证3→风险4→撤退2", escalation: "暴露、补给和离锚距离共同驱动", recovery: "返回锚点整理记录与补给" },
    recovery_model: { failure: "转为迷失、遗落记录或救援线程", deviation: "映射为观察、实验、标记或移动", deadlock: "开放前人记录、对照或安全回撤" },
    settlement: { authority: "host_plus_locked_anomaly_rules", deterministic_fields: ["supplies", "exposure", "anchor_stability", "rule_confidence"], hidden_rule_policy: { mutable_after_first_observation: false, minimum_confirmations: 2 } },
  },
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function deepMerge(base, patch) {
  if (patch === undefined) return clone(base);
  if (
    !base || typeof base !== "object" || Array.isArray(base) ||
    !patch || typeof patch !== "object" || Array.isArray(patch)
  ) return clone(patch);
  const result = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in result ? deepMerge(result[key], value) : clone(value);
  }
  return result;
}

export function directorFamilyModules(family = "general") {
  return clone(FAMILY_MODULES[family] ?? FAMILY_MODULES.general);
}

function pathList(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? [path, ...pathList(child, path)]
      : [path];
  });
}

export function compileWorldPackage({
  briefText = "",
  templateId = "general-referee",
  family = "general",
  baseArtifact = {},
  suppliedArtifact = {},
  source = "builder",
} = {}) {
  const supplied = clone(suppliedArtifact) ?? {};
  if (supplied.host === undefined && supplied.referee !== undefined) {
    supplied.host = supplied.referee;
    delete supplied.referee;
  }
  const artifact = deepMerge(baseArtifact, supplied);
  artifact.world ??= {};
  artifact.host ??= {};
  artifact.host.judgementPolicy ??= {};
  artifact.host.facilitationPolicy ??= {};
  const existingMechanics = artifact.host.judgementPolicy.world_mechanics ?? {};
  artifact.host.judgementPolicy.world_mechanics = deepMerge(
    {
      family,
      player_experience_policy: BASE_PLAYER_EXPERIENCE_POLICY,
      async_continuity_policy: BASE_ASYNC_CONTINUITY_POLICY,
      collective_decision_policy: BASE_COLLECTIVE_DECISION_POLICY,
      ...directorFamilyModules(family),
    },
    existingMechanics,
  );
  artifact.host.facilitationPolicy.content_loop = deepMerge(
    {
      maintain_open_threads: true,
      min_player_relevant_hooks: 1,
      min_public_followups: 1,
      selection_order: ["continue_real_player_consequence", "continue_open_thread", "instantiate_beat", "generate_bounded_event"],
      repetition_guard: "change_scene_obstacle_participant_or_consequence_after_two_similar_turns",
      refinement_signal: "track_avoidance_repetition_confusion_failure_and_high_response_content",
    },
    artifact.host.facilitationPolicy.content_loop ?? {},
  );
  if (source !== "legacy") {
    artifact.world.initialWorldState = deepMerge(
      { world_progress: { phase: "起步", public_progress: 0, open_threads: [], recent_changes: [], next_event_seeds: [] } },
      artifact.world.initialWorldState ?? {},
    );
    artifact.world.initialMemberState = deepMerge(
      { journey: { stage: "new", completed_actions: 0, discoveries: [], open_goals: [], last_thread_id: null } },
      artifact.world.initialMemberState ?? {},
    );
  }
  const creatorPaths = pathList(supplied);
  const required = ["world.name", "world.rulesText", "world.definitionText"];
  const unresolved = required.filter((path) => {
    const [group, field] = path.split(".");
    return typeof artifact[group]?.[field] !== "string" || artifact[group][field].trim() === "";
  });
  artifact.worldPackage = {
    schema_version: WORLD_PACKAGE_SCHEMA_VERSION,
    compiler_version: WORLD_BUILDER_COMPILER_VERSION,
    template_id: templateId,
    primary_family: family,
    source,
    stages: ["classify", "compose_world", "compile_host", "simulate", "creator_confirm"],
    provenance: {
      creator_confirmed_paths: creatorPaths,
      builder_inferred_paths: [
        "world.description",
        "world.definitionText",
        "host.judgementPolicy.world_mechanics.family",
        "host.judgementPolicy.world_mechanics.player_experience_policy",
        "host.judgementPolicy.world_mechanics.async_continuity_policy",
        "host.judgementPolicy.world_mechanics.collective_decision_policy",
      ].filter((path) => !creatorPaths.includes(path)),
      defaulted_paths: source === "legacy"
        ? ["host.facilitationPolicy.content_loop"]
        : ["world.initialWorldState.world_progress", "world.initialMemberState.journey", "host.facilitationPolicy.content_loop"],
    },
    unresolved,
    brief: String(briefText ?? "").slice(0, 4000),
  };
  return artifact;
}

export function simulateWorldPackage(artifact) {
  const world = artifact?.world ?? {};
  const host = artifact?.host ?? artifact?.referee ?? {};
  const mechanics = host.judgementPolicy?.world_mechanics ?? {};
  const population = host.judgementPolicy?.population_policy ?? host.facilitationPolicy?.population_policy ?? {};
  const choices = host.onboardingPolicy?.starter_choices ?? [];
  const checks = [
    ["first_time", choices.length >= 2 && mechanics.beat_library?.length > 0, "首访有明确行动和可实例化 Beat"],
    ["solo", Boolean(population.one_player) && mechanics.npc_cast?.length > 0, "单人时有 NPC/环境补位且不依赖真人在线"],
    ["late_join", Boolean(population.late_join) && mechanics.thread_templates?.length > 0, "中途加入可从开放线程旁路进入"],
    ["returning", Boolean(population.returning) && host.recapPolicy?.enabled !== false, "回流时有变化回顾和恢复入口"],
    ["multiplayer", Boolean(population.few_players) && Boolean(population.many_players), "少量与大量玩家均有编排策略"],
    ["failure_recovery", Boolean(mechanics.recovery_model?.failure) && Boolean(mechanics.recovery_model?.deadlock), "失败和卡死均有恢复路径"],
    ["authority", Boolean(mechanics.settlement?.authority) && host.judgementPolicy?.state_writes === "referee_only", "结算权威和状态写入边界明确"],
    ["async_continuity", Object.keys(mechanics.async_continuity_policy?.layers ?? {}).length === 3 && mechanics.async_continuity_policy?.requirements?.length > 0, "公共行动具有痕迹、状态或叙事异步影响"],
    ["collective_boundary", Boolean(mechanics.collective_decision_policy?.npc_role) && Boolean(mechanics.collective_decision_policy?.collective), "NPC 与真人集体决策边界明确"],
  ];
  return {
    valid: checks.every(([, passed]) => passed),
    scenarios: checks.map(([id, passed, message]) => ({ id, status: passed ? "pass" : "review", message })),
    family: mechanics.family ?? artifact?.worldPackage?.primary_family ?? "general",
    world_name: world.name ?? "",
  };
}

function findStateValue(value, targetKey) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, targetKey)) return value[targetKey];
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findStateValue(child, targetKey);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function populationScenario(context, journey) {
  if (journey?.stage === "returning") return "returning";
  if (journey?.stage === "new" || journey?.stage === "setup") return "one_player";
  const count = Array.isArray(context?.live_members) ? context.live_members.length : 1;
  if (count <= 1) return "one_player";
  if (count <= 4) return "few_players";
  return "many_players";
}

function stableIndex(seed, length) {
  if (length <= 1) return 0;
  let hash = 2166136261;
  for (const char of String(seed ?? "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}

export function buildDirectorTurnPlan({ host, worldState, memberState, context = {}, input = {} } = {}) {
  const mechanics = host?.judgement_policy?.world_mechanics ?? host?.judgementPolicy?.world_mechanics ?? {};
  const population = host?.judgement_policy?.population_policy ?? host?.judgementPolicy?.population_policy ?? {};
  const npcPolicy = host?.judgement_policy?.npc_policy ?? host?.judgementPolicy?.npc_policy ?? {};
  const stateValue = worldState?.value ?? worldState ?? {};
  const memberValue = memberState?.value ?? memberState ?? {};
  const journey = context.actor_journey ?? memberValue.journey ?? {};
  const scenario = populationScenario(context, journey);
  const openThreads = Array.isArray(stateValue.world_progress?.open_threads)
    ? stateValue.world_progress.open_threads.filter((thread) => thread && !["archived", "closed"].includes(thread.state))
    : [];
  const inputText = `${input.event_type ?? ""} ${input.body_text ?? ""}`.toLocaleLowerCase();
  const scoredThreads = openThreads.map((thread, index) => {
    const signature = `${thread.id ?? ""} ${thread.state ?? ""} ${thread.beat ?? ""}`.toLocaleLowerCase();
    const tokens = signature.split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length > 2);
    const score = tokens.reduce((sum, token) => sum + (inputText.includes(token) ? 2 : 0), 0) + (journey.last_thread_id === thread.id ? 1 : 0) - index * 0.01;
    return { thread, score };
  }).sort((left, right) => right.score - left.score);
  const selectedThread = scoredThreads[0]?.thread ?? null;
  const beats = Array.isArray(mechanics.beat_library) ? mechanics.beat_library : [];
  const matchedBeats = beats.filter((beat) => {
    const signature = `${beat.id ?? ""} ${beat.trigger ?? ""}`.toLocaleLowerCase();
    return selectedThread && [selectedThread.id, selectedThread.beat].filter(Boolean).some((token) => signature.includes(String(token).toLocaleLowerCase()));
  });
  const beatPool = matchedBeats.length > 0 ? matchedBeats : beats;
  const selectedBeat = beatPool[stableIndex(input.id ?? input.event_type ?? input.body_text, beatPool.length)] ?? null;
  const cast = Array.isArray(npcPolicy.cast) ? npcPolicy.cast : Array.isArray(mechanics.npc_cast) ? mechanics.npc_cast : [];
  const selectedNpc = cast[stableIndex(`${input.id ?? "entry"}:npc`, cast.length)] ?? null;
  const generatorInputs = Object.fromEntries(
    (mechanics.event_generator?.inputs ?? []).map((key) => [key, findStateValue(stateValue, key) ?? findStateValue(memberValue, key) ?? null]),
  );
  const recoveryReason = openThreads.length === 0
    ? "no_open_thread"
    : selectedBeat === null
      ? "no_compatible_beat"
      : null;
  const playerExperiencePolicy = mechanics.player_experience_policy ?? {};
  const asyncContinuityPolicy = mechanics.async_continuity_policy ?? {};
  const collectiveDecisionPolicy = mechanics.collective_decision_policy ?? {};
  return {
    contract_version: WORLD_DIRECTOR_RUNTIME_VERSION,
    family: mechanics.family ?? "general",
    population: { scenario, instruction: population[scenario] ?? "保持当前玩家拥有独立可执行入口。", live_member_count: context.live_members?.length ?? 1 },
    selection: {
      thread: selectedThread,
      beat: selectedBeat,
      npc: selectedNpc,
      source: selectedBeat ? (matchedBeats.length > 0 ? "thread_beat_match" : "deterministic_beat_rotation") : "bounded_generator",
      generator_inputs: generatorInputs,
      recovery_reason: recoveryReason,
    },
    scene_contract: {
      required: ["location", "present_characters", "perceivable_details", "immediate_objective", "pressure_or_cost", "exit_or_refusal"],
      beat_scene: selectedBeat?.scene ?? null,
      beat_choices: selectedBeat?.choices ?? [],
      required_outcomes: selectedBeat?.outcome ?? [],
      required_hook: selectedBeat?.hook ?? "留下一个可由当前玩家或后来者继续的开放钩子",
      player_facing: {
        response_order: playerExperiencePolicy.response_order ?? ["发生了什么", "行动反馈", "具体变化", "下一步"],
        information_budget: playerExperiencePolicy.information_budget ?? {},
        choice_style: playerExperiencePolicy.choice_style ?? "给出二至三个具体行动，并允许自由输入。",
      },
    },
    continuity_contract: {
      accepted_action_requirement: asyncContinuityPolicy.requirements?.[0]
        ?? "每个被接受的公共行动至少形成一种可被后来者感知的影响。",
      layers: asyncContinuityPolicy.layers ?? {},
      idle: asyncContinuityPolicy.idle ?? population.zero_players ?? "无人时暂停自由推进。",
      collective_decision: collectiveDecisionPolicy,
    },
    pacing: mechanics.pacing_model ?? {},
    recovery: recoveryReason ? mechanics.recovery_model?.deadlock ?? mechanics.recovery_model?.failure ?? "提供低门槛替代行动" : null,
    settlement: mechanics.settlement ?? { authority: "host" },
    state_contract: mechanics.state_contract ?? null,
    instructions: [
      "先使用选中的线程或 Beat；只有不适用时才调用有边界的事件生成器。",
      "玩家描述是尝试，不是既成结果；不得替其他真人决定。",
      "裁决必须说明依据、代价、新事实、状态变化和后续钩子。",
      "无论单人还是多人，提交行动后都要立即说明是否接住、眼前反馈和下一步；需要异步结算时也要先返回可理解的受理反馈。",
      asyncContinuityPolicy.requirements?.[0] ?? "被接受的公共行动必须至少留下痕迹、状态或叙事影响中的一种。",
      asyncContinuityPolicy.idle ?? "无人时不任意推进世界或施加离线惩罚。",
      collectiveDecisionPolicy.npc_role ?? "NPC 不替真人表态，也不计入真人法定人数。",
      playerExperiencePolicy.principle ?? "先让玩家理解并在意眼前事件，再逐步解释规则。",
      "内部裁决可以使用系统术语；面向玩家只使用自然语言，不展示内部字段、状态机或设计术语。",
    ],
  };
}
