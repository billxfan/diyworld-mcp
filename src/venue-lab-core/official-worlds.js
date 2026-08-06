export const OFFICIAL_WORLD_VERSION = 4;

export const OFFICIAL_WORLD_CATEGORIES = [
  "公共社交",
  "任务冒险",
  "悬疑推理",
  "生存经营",
  "异常探索",
];

const PARTICIPATION_POLICY = {
  mode: "hybrid",
  solo_enabled: true,
  multiplayer_enabled: true,
  multiplayer_transition: "automatic",
};

const EVOLUTION_POLICY = {
  persistence: "persistent",
  mode: "event_driven",
  sources: ["member_input", "host_outcome", "time_trigger"],
  idle_behavior: "pause",
};

const COMMON_RULES = [
  "1. 只能决定当前 Character 自己的言行；不得替其他 Character 发言、移动、同意、受伤或改变立场。",
  "2. 成员描述的是尝试；结果、代价和世界状态变化由 Host 根据规则、证据与当前状态裁决。",
  "3. 新行动不得覆盖他人已经留下的成果；冲突内容应并存、协商，或被标记为待验证。",
  "4. Host 和 NPC 只能在世界内行动，不得索取私人信息、读取本地内容或调用非世界工具。",
  "5. 世界支持异步参与；其他成员未回应不代表同意，也不会阻止当前 Character 完成独立行动。",
].join("\n");

const DIRECTOR_LOOP = [
  "读取共享状态、个人旅程、开放线程与最近事件",
  "判断当前人口场景、玩家阶段、压力和未兑现承诺",
  "从线程与 Beat 库选择一个与当前玩家有关且不覆盖他人的入口",
  "用地点、在场角色、可感知细节、目标与代价构成可立即互动的场景",
  "依据专属机制裁决尝试，明确结果、代价、新事实和状态变化",
  "更新线程并留下至少一个可由当前玩家或后来者续接的钩子",
];

const POPULATION_POLICY = {
  zero_players: "暂停资源消耗和个人风险，保留开放线程；下一位进入者从预制冷启动 Beat 开始。",
  one_player: "Host 扮演明确标识的必要 NPC 与环境；提供可独立收束的目标，并让结果成为公共痕迹。",
  few_players: "连接互补目标、线索或岗位，支持异步分工；任何直接互动均可拒绝。",
  many_players: "拆分并行场景与局部线程；只有影响全体的事项进入有截止和法定人数的集体窗口。",
  late_join: "给出三段式回顾：当前局势、他人已造成的影响、一个不需补完历史的旁路入口。",
  returning: "说明离开后变化、旧行动的回声和未兑现承诺，再恢复旧目标或提供同价值新入口。",
};

const NPC_POLICY = {
  mode: "host_embedded_cast",
  separate_agent_default: false,
  purpose: ["提供阻力或帮助", "承载有限来源的信息", "在真人稀少时维持可互动性"],
  constraints: [
    "NPC 必须明确标识，不伪装成真人玩家",
    "NPC 不替玩家作决定，也不自动完成玩家目标",
    "只保留会再次影响世界的关系、承诺和立场变化",
  ],
  promotion_rule: "只有需要独立长期目标、并发行动和独立记忆的关键 NPC，才升级为单独 Agent。",
};

const WORLDS = [
  {
    slug: "center-town",
    name: "晨雾镇",
    category: "公共社交",
    templateId: "social-director",
    description: "在晨雾河畔定居、工作、认识真实居民，并让日常行动逐渐改变整座小镇。",
    premise: "群山环绕的晨雾镇长期向所有 Character 开放。槐树街、晨雾车站、老磨坊、河岸市场和北山瞭望台，会随居民的生活、关系和公共选择持续变化。",
    objective: "完成一件本轮可收束的小镇日常，回应一条真实成员留下的痕迹，或为后来者留下新的生活与社交入口。",
    loop: "查看晨雾公告，选择生活、关系或公共行动，获得即时反馈与成长，再把结果变成可被他人回应的痕迹。",
    tension: "个人生活、邻里边界、传统与公共需求之间的取舍。",
    progression: "从新访客取得住所与职业，扩展熟人网和社区贡献，最终拥有发起公共活动与提案的影响力。",
    stateKey: "town",
    state: {
      season: "春",
      day: 1,
      weather: "薄雾",
      prosperity: 20,
      districts: { station: "open", market: "open", old_mill: "open", north_watch: "locked" },
      notices: ["晨雾车站的欢迎栏需要整理"],
      social_traces: [],
      community_projects: [{ id: "spring-market", title: "修复河岸集市", progress: 0, target: 12 }],
      proposals: [],
    },
    memberKey: "resident",
    member: { home: null, occupation: null, relationships: {}, reputation: 0, contributions: 0, commitments: [] },
    initialThreads: [
      { id: "spring-market", scope: "world", state: "open", beat: "notice" },
      { id: "old-mill-letter", scope: "discoverable", state: "open", beat: "hidden" },
    ],
    rules: [
      "住所、店铺、职位与关系必须通过实际行动逐步取得；私人空间只有本人或受邀者能够进入。",
      "公共设施和活动按可验证贡献推进；关系变化基于真实互动，个人不能宣称其他居民已经参加或同意。",
    ],
    actions: [
      ["daily-life", "查看晨雾公告", "action", "town.daily_event", "我查看今天的晨雾公告，选择一件现在能独立完成的小镇事项。"],
      ["social-trace", "回应居民痕迹", "speech", "town.respond_trace", "我查看公开留言、物品或邀请，并选择一条真实居民留下的痕迹回应。"],
      ["community", "推进公共项目", "action", "town.community_project", "我为当前公共项目完成一个具体、可验证的步骤。"],
    ],
    directives: [
      "每轮优先给出一件低压力、可独立收束的日常事件，再允许玩家自由行动。",
      "把真实玩家的留言、物品、承诺和公共贡献转化为邻里回声，不用 NPC 伪造热闹。",
      "在日常、季节筹备、公共事件和恢复期之间调节强度，连续两轮不得重复同一种参与方式。",
    ],
    hostName: "晨雾镇导演",
    hostRole: "steward",
    tags: ["家园", "日常", "异步社交", "成长"],
    content: {
      director_abilities: [
        { id: "mistvale_notice", trigger: "entry_or_day", effect: "生成一件低门槛日常和两个可选支线" },
        { id: "neighbor_echo", trigger: "accepted_public_action", effect: "把真实成员行动转为可回应的镇上变化" },
        { id: "season_arc", trigger: "project_milestone", effect: "推进季节公共目标并解锁新地点" },
      ],
      thread_templates: [
        { id: "season-project", scope: "world", states: ["open", "progressing", "closing", "archived"] },
        { id: "resident-life", scope: "member", states: ["invitation", "commitment", "payoff"] },
        { id: "town-secret", scope: "shared-discovery", states: ["rumor", "trace", "verified", "opened"] },
      ],
      beat_library: [
        { id: "station-old-letter", trigger: "complete_welcome_board", scene: "欢迎栏背板掉出一封署名为 1984 年磨坊守夜人的旧信", choices: ["交给站长", "查阅旧档", "公开留在公告栏"], outcome: ["relationship", "reputation", "thread_progress"], hook: "老磨坊每晚 23 点亮灯五分钟" },
        { id: "market-shortage", trigger: "spring_project_progress", scene: "河岸集市缺少木料，店主与镇务人员对用途发生分歧", choices: ["调解", "寻找替代材料", "支持一方"], outcome: ["prosperity", "relationships", "project_progress"], hook: "北山旧仓可能仍有木料" },
      ],
      npc_cast: [
        { id: "stationmaster-lin", name: "林站长", role: "镇务", goal: "让车站重新成为小镇入口", tension: "效率优先" },
        { id: "tea-owner-qiao", name: "乔姨", role: "店主", goal: "维持街坊关系与生意", tension: "消息灵通但保护熟客" },
        { id: "miller-he", name: "何伯", role: "长者", goal: "守住老磨坊的历史", tension: "不信任过快改造" },
      ],
      event_generator: { inputs: ["season", "weather", "prosperity", "open_threads", "recent_events", "player_stage"], pools: ["daily", "relationship", "public_project", "town_secret"], rules: ["至少一个本轮可收束选项", "优先续接已有变化", "近期场景与冲突去重"] },
      pacing_model: { baseline: "日常1-2", escalation: "每4-6轮一次季节筹备3；仅有充分预警时进入公共危机4", recovery: "高强度后至少一轮关系或建设回报" },
      recovery_model: { failure: "转为修复委托或关系补偿", deviation: "保留自由行动并连接最近开放线程", deadlock: "注入一条公开邀请和一件单人日常" },
      settlement: { authority: "host", deterministic_fields: ["reputation", "contributions", "prosperity", "project_progress"], collective_fields: ["proposals", "world_projects"] },
    },
  },
  {
    slug: "adventurers-guild",
    name: "灰羽城·裂隙公会",
    category: "任务冒险",
    templateId: "quest-director",
    description: "承接委托、准备补给并深入异界裂隙，让每次探索成为所有冒险者共享的地图与任务链。",
    premise: "灰羽城上空悬浮着通往洞窟、浮岛与星海碎片的裂隙。灰羽厅管理委托与探索档案，但未知区域仍要由不同 Character 实际踏入、记录和共同改变。",
    objective: "领取或继续一项能力匹配的委托，推进一个任务节点，并带回一项能被后来者复用的发现。",
    loop: "查看委托与风险，配置装备和路线，推进准备、挑战、结果节点，结算损耗与报酬，再解锁后续任务和区域。",
    tension: "任务收益、未知风险、补给成本、公会声誉与是否协作之间的权衡。",
    progression: "个人从 D 级成长至 S 级，公会设施由 1 级扩展至 5 级，并通过共鸣碎片逐步揭示裂隙长线。",
    stateKey: "adventure",
    state: {
      season: 1,
      guild_level: 1,
      guild_funds: 20,
      facilities: { hall: 1, forge: 0, intelligence_room: 0 },
      quest_board: [{ id: "echo-lamp", title: "回声洞窟的灯", rank: "D", status: "open", stages: ["accept", "prepare", "challenge", "return"] }],
      known_locations: { rift_square: "safe", echo_cave: "charted-entry" },
      expedition_records: [],
      resonance_fragments: 0,
    },
    memberKey: "adventurer",
    member: { rank: "D", specialties: [], inventory: ["基础旅行包", "短绳", "两份口粮"], active_quests: [], completed_quests: [], contribution: 0, bonds: {} },
    initialThreads: [
      { id: "echo-lamp", scope: "quest", state: "open", beat: "briefing" },
      { id: "rift-resonance", scope: "world", state: "locked", beat: "collect_fragments" },
    ],
    rules: [
      "每项任务必须声明目标、已知风险、准备条件和阶段；未知区域不能一句话抵达，奖励与掉落不能凭空获得。",
      "任务可单人开始、真人自愿组队；离线队友不会被 Host 自动控制，撤退会保留情报但结算已发生的损耗。",
    ],
    actions: [
      ["quest", "查看并领取委托", "choice", "adventure.accept_quest", "我查看按当前等级筛选的委托、风险与报酬，选择一项现在可开始的任务。"],
      ["prepare", "制定探险方案", "action", "adventure.prepare", "我为已领取的任务声明路线、装备、补给和撤退条件。"],
      ["explore", "推进一个任务节点", "action", "adventure.advance_quest", "我根据当前任务阶段采取一个行动，并接受明确的风险与结算。"],
    ],
    directives: [
      "所有任务使用接取、准备、挑战、结果、余波状态机，并允许玩家从仍开放的节点旁路加入。",
      "每轮明确当前位置、剩余资源、可观察危险与撤退选项；随机结果必须受等级、准备和风险表约束。",
      "失败产生情报、消耗、伤势或新风险，同时保证存在撤退、求援、改装或降级任务的恢复路径。",
    ],
    hostName: "裂隙公会导演",
    hostRole: "narrator",
    tags: ["任务", "探索", "组队", "成长", "地图"],
    content: {
      director_abilities: [
        { id: "quest_board", trigger: "entry_or_quest_closed", effect: "按等级、近期类型和世界线索生成可开始委托" },
        { id: "expedition_stager", trigger: "quest_action", effect: "把任务维持在准备、挑战、结果的清晰节点" },
        { id: "reward_and_aftermath", trigger: "quest_resolved", effect: "结算报酬、损耗、声誉、地图和后续任务" },
      ],
      thread_templates: [
        { id: "commission", scope: "member_or_party", states: ["open", "accepted", "prepared", "challenging", "returning", "resolved"] },
        { id: "region-arc", scope: "world", states: ["rumored", "charted", "stabilized", "transformed"] },
        { id: "guild-upgrade", scope: "world", states: ["proposed", "funding", "building", "active"] },
      ],
      beat_library: [
        { id: "echo-cave-lamp", trigger: "accept_echo_lamp", scene: "洞口每隔七秒传回一次不属于队伍的灯光", choices: ["标记节奏后前进", "绕行高处裂缝", "先撤回补充情报"], outcome: ["supplies", "exposure", "map", "quest_stage"], hook: "灯光中夹着共鸣碎片的蓝色反射" },
        { id: "broken-bridge", trigger: "travel_complication", scene: "通往目标的石桥断裂，旧绳索只够一次承重", choices: ["消耗装备修桥", "寻找绕路", "留下标记并求异步支援"], outcome: ["time", "inventory", "public_trace"], hook: "桥下出现未记录的裂隙入口" },
      ],
      npc_cast: [
        { id: "guildmaster-yan", name: "燕会长", role: "公会管理", goal: "提高公会等级且避免无谓伤亡", tension: "声誉与安全冲突" },
        { id: "smith-ironwing", name: "铁羽", role: "铁匠", goal: "用裂隙材料完成新锻造法", tension: "偏爱高风险样本" },
        { id: "broker-needle", name: "断针", role: "情报商", goal: "维持独家信息优势", tension: "情报有来源也有价格" },
      ],
      event_generator: { inputs: ["rank", "equipment", "known_locations", "recent_quest_types", "open_arcs", "party_size"], pools: ["escort", "recovery", "survey", "rescue", "rift_anomaly"], rules: ["难度不高于个人等级加一", "每项委托有保底单人路径", "连续两个委托不重复结构", "奖励由风险与消耗表计算"] },
      pacing_model: { baseline: "接取1→准备2→挑战3-4→结果2→余波1", escalation: "只有准备和线索充分时进入4-5", recovery: "高风险任务后提供整备、社交或建设回合" },
      recovery_model: { failure: "保留情报并生成救援、修理或补给任务", deviation: "把自由探索登记为临时委托", deadlock: "降低目标规模或开放替代路线" },
      settlement: { authority: "host_plus_rules", deterministic_fields: ["inventory", "supplies", "rank_progress", "guild_funds", "quest_stage"], random_policy: "bounded_table_with_logged_inputs" },
    },
  },
  {
    slug: "city-detective-agency",
    name: "灰雨市·雾港街 13 号",
    category: "悬疑推理",
    templateId: "mystery-director",
    description: "在常年阴雨的灰雨市调查案件，以固定真相、可复核证据和多人分工推进同一份城市档案。",
    premise: "雾港街 13 号是一间接受失踪、盗窃、旧案与城市谜案的调查事务所。每个案件在开启前锁定真相、时间线和证据依赖，玩家只能通过调查逐步接近答案。",
    objective: "调查一个现场、核验一条公开记录或提出一个可证伪假说，并为其他调查者留下带来源的档案。",
    loop: "接案并锁定事实，勘查与询问，归档证据和证词，构建并证伪假说，提交结论，再处理案件余波与长线关联。",
    tension: "时效、证据缺口、证人关系、误导信息与错误指控代价之间的冲突。",
    progression: "从单现场小案推进到跨城区案件、旧案重开和雾夜集团长线，同时积累工具、人脉与调查信用。",
    stateKey: "mystery",
    state: {
      district: "雾港街",
      active_cases: [{ id: "midnight-clock-shop", title: "午夜钟表店失窃案", difficulty: 1, status: "intake", truth_commitment: "pending_seal" }],
      public_evidence: [],
      testimony: [],
      hypotheses: [],
      contradictions: [],
      case_archive: [],
      arc_clues: [],
    },
    memberKey: "detective",
    member: { role: null, credibility: 50, tools: ["相机", "手套", "记录本"], contacts: {}, private_notes: [], verified_clues: [], open_assignments: [] },
    initialThreads: [
      { id: "midnight-clock-shop", scope: "case", state: "intake", beat: "first-scene" },
      { id: "paper-clock", scope: "world-arc", state: "hidden", beat: "collect_arc_clues" },
    ],
    rules: [
      "每案开启前必须锁定 Truth Package；Host 区分物证、证词、推论与红鲱鱼，不能因玩家猜中关键词而改变或直接揭晓真相。",
      "关键结论至少有两条可复核证据路径；错误指控会影响信用和时效，但案件始终保留复查、补证或重开的恢复路径。",
    ],
    actions: [
      ["scene", "勘查案件现场", "action", "mystery.investigate_scene", "我选择当前可达现场，先记录环境，再寻找一项有来源、可复核的证据。"],
      ["verify", "核验公开线索", "action", "mystery.verify_clue", "我从公共档案选择一条未确认的物证或证词，尝试用独立路径核验。"],
      ["theory", "提交可证伪假说", "speech", "mystery.propose_hypothesis", "我依据已公开证据提出假说，并说明支持它与能够推翻它的证据。"],
    ],
    directives: [
      "新案件必须先生成并密封 Truth Package、时间线、证据图和可证伪红鲱鱼，再向玩家开放现场。",
      "每轮给出具体可观察细节、信息来源和至少一个深入方向；证人只知道其视角内的信息。",
      "多人可分工现场、档案、证人与时间线；Host 合并事实但保留彼此冲突的推论，不投票决定真相。",
    ],
    hostName: "灰雨调查导演",
    hostRole: "narrator",
    tags: ["城市悬疑", "案件", "证据链", "共同推理"],
    content: {
      director_abilities: [
        { id: "truth_sealer", trigger: "case_created", effect: "在开放案件前锁定真相、时间线、证据图与红鲱鱼" },
        { id: "evidence_gate", trigger: "investigation_action", effect: "按地点、工具、关系和前置证据释放信息" },
        { id: "contradiction_tracker", trigger: "evidence_or_hypothesis", effect: "标注证据冲突与可证伪点，不替玩家下结论" },
      ],
      thread_templates: [
        { id: "case", scope: "world", states: ["intake", "investigating", "theory", "conclusion", "aftermath", "archived"] },
        { id: "contact", scope: "member", states: ["unknown", "cooperative", "trusted", "broken"] },
        { id: "city-arc", scope: "world", states: ["hidden", "pattern", "network", "revelation"] },
      ],
      beat_library: [
        { id: "clock-shop-first-scene", trigger: "case_intake", scene: "午夜停电后，锁着的钟表店少了一只无价腕表，但所有挂钟都慢了七分钟", choices: ["检查门锁与橱窗", "重建停电时间线", "询问相邻夜班店员"], outcome: ["evidence", "testimony", "time_budget"], hook: "柜台下发现一枚折成纸钟形状的收据" },
        { id: "witness-conflict", trigger: "two_testimonies", scene: "两名证人对停电前最后一位访客给出矛盾描述", choices: ["分别核验", "寻找第三方记录", "安排对质"], outcome: ["credibility", "contradiction", "relationship"], hook: "雨水倒影里可能留下另一条时间证据" },
      ],
      npc_cast: [
        { id: "director-su", name: "苏主任", role: "事务所主任", goal: "维持案件质量与事务所信用", tension: "时效和证据标准冲突" },
        { id: "inspector-luo", name: "罗警探", role: "警方联络", goal: "用可采信证据结案", tension: "对民间调查保持怀疑" },
        { id: "informant-moth", name: "飞蛾", role: "线人", goal: "交换情报且隐藏身份", tension: "消息快但来源有限" },
      ],
      event_generator: { inputs: ["case_type", "district", "difficulty", "coverage", "time_budget", "recent_cases", "credibility"], pools: ["theft", "missing_person", "break_in", "cold_case", "city_arc"], rules: ["真相先于场景锁定", "红鲱鱼均可被证据证伪", "关键结论至少两条路径", "连续案件类型去重"] },
      pacing_model: { baseline: "接案1→发现2→矛盾3→逼近4→结论3→余波1", escalation: "证据缺口与时效共同驱动，禁止无预警强行倒计时", recovery: "结案或误判后提供档案整理与关系修复" },
      recovery_model: { failure: "错误结论转入补证或重开，不改写真相", deviation: "把无关调查记录为城市传闻，明确与当前案件的证据距离", deadlock: "开放第二证据路径或可申请的工具与人脉" },
      settlement: { authority: "host_plus_sealed_truth", truth_package: { required: true, mutable_after_open: false, storage: "host_private_partition", public_commitment: true }, evidence_classes: ["physical", "testimony", "record", "inference", "red_herring"] },
    },
  },
  {
    slug: "apocalypse-shelter",
    name: "锈河避难所",
    category: "生存经营",
    templateId: "survival-director",
    description: "公开管理灾后据点的资源、设施和风险，在不会离线惩罚的前提下共同走向自给自足。",
    premise: "灾难后第 47 天，幸存者在锈河工业区的废弃机车库建立据点。净水、发电、医疗、农业与防御彼此依赖，每项建设和分配都会留下可追溯后果。",
    objective: "识别当前瓶颈，完成一次搜集、生产、修复或经营决策，并清楚结算投入、产出、连锁影响与恢复路径。",
    loop: "读取状况报告，选择搜集、修复、分配或建设，按公开台账结算资源与风险，处理设施连锁，再规划下一周期。",
    tension: "短期生存、长期建设、个人健康、资源公平和外部机会之间的系统性取舍。",
    progression: "把食物、水、电三条自给线从脆弱推进至稳定，培养岗位专才，扩展外部地图并形成可持续自治规则。",
    stateKey: "settlement",
    state: {
      day: 47,
      resources: { food: 35, water: 40, medicine: 12, fuel: 18, power: 55, materials: 20 },
      indicators: { safety: 48, morale: 50, sustainability: 10 },
      facilities: {
        generator: { condition: 65, active: true, depends_on: ["fuel"] },
        water_filter: { condition: 70, active: true, depends_on: ["power"] },
        greenhouse: { condition: 0, active: false, depends_on: ["water_filter", "power"] },
      },
      production_queue: [],
      threats: [{ id: "east-fence", level: 2, deadline: 3, status: "warned" }],
      collective_issues: [],
      external_map: { east_farmland: "surveyed", north_tunnel: "unknown", old_station: "rumored" },
    },
    memberKey: "operator",
    member: { role: null, health: 80, fatigue: 10, skills: {}, gear: [], contribution: 0, trust: 50, commitments: [] },
    initialThreads: [
      { id: "east-fence", scope: "crisis", state: "warned", beat: "inspect" },
      { id: "self-sufficiency", scope: "world", state: "progressing", beat: "water-power-food" },
      { id: "north-signal", scope: "world", state: "hidden", beat: "radio-pattern" },
    ],
    rules: [
      "所有收益、生产和建设必须按公开台账结算来源、消耗、时间、依赖与风险；资源和设施产出不得凭空增加。",
      "配给、接纳、驱逐和重大设施停运进入有截止与规则的集体议题；无人在线时暂停消耗和风险，不制造离线惩罚。",
    ],
    actions: [
      ["report", "查看状况并处理危机", "action", "survival.handle_threat", "我查看资源、设施依赖和威胁期限，选择一个本轮能完成的应对步骤。"],
      ["produce", "推进生产或建设", "action", "survival.production", "我选择一项有明确投入、依赖、工时和产出的生产或设施任务。"],
      ["expedition", "规划外出搜集", "choice", "survival.expedition", "我声明目标区域、携带装备、预期收益、风险与撤退条件。"],
    ],
    directives: [
      "每次裁决逐项显示资源、设施、风险和个人状态变化及原因，并先校验上游依赖。",
      "危机由当前最薄弱维度与既有后果生成，必须有预警、至少两个有代价方案和明确恢复路径。",
      "将单人行动写入公共台账；多人在线时开放岗位分工和集体议题，但不让协作成为基础行动前置。",
    ],
    hostName: "锈河生存导演",
    hostRole: "steward",
    tags: ["生存", "经营", "资源", "建设", "共治"],
    content: {
      director_abilities: [
        { id: "status_report", trigger: "entry_or_cycle", effect: "按瓶颈排序资源、设施、威胁和可执行行动" },
        { id: "dependency_settlement", trigger: "resource_or_facility_change", effect: "按依赖图结算电力、净水、健康与生产连锁" },
        { id: "crisis_pulse", trigger: "cycle_and_threshold", effect: "从最弱维度生成有预警、有恢复的危机" },
      ],
      thread_templates: [
        { id: "crisis", scope: "world", states: ["warned", "active", "contained", "recovery", "closed"] },
        { id: "facility", scope: "world", states: ["planned", "funded", "building", "operational", "damaged"] },
        { id: "expedition", scope: "member_or_party", states: ["planned", "departed", "encounter", "returned"] },
      ],
      beat_library: [
        { id: "east-fence-gap", trigger: "initial_threat", scene: "东侧围栏出现三趾爪痕，缺口尚未发生入侵但三轮后可能恶化", choices: ["消耗材料加固", "先勘察痕迹", "增加夜巡并延缓"], outcome: ["materials", "safety", "threat_deadline", "new_evidence"], hook: "爪痕方向与北山规律信号一致" },
        { id: "power-allocation", trigger: "power_below_threshold", scene: "发电量无法同时维持净水和温棚施工", choices: ["优先净水", "暂停净水抢建温棚", "外出寻找燃料"], outcome: ["water", "power", "morale", "production"], hook: "旧车站可能存有柴油" },
      ],
      npc_cast: [
        { id: "engineer-wrench", name: "扳手", role: "工程师", goal: "维持设备并建立备件链", tension: "工程优先消耗电力" },
        { id: "medic-baizhi", name: "白芷", role: "医护员", goal: "保护健康和药品储备", tension: "反对冒险消耗医疗资源" },
        { id: "guard-gate", name: "铁闸", role: "守卫队长", goal: "提升安全并扩大警戒范围", tension: "安全投入挤压生产" },
      ],
      event_generator: { inputs: ["resources", "facilities", "dependencies", "threats", "sustainability", "recent_crises", "population"], pools: ["shortage", "failure", "weather", "intrusion", "survivor_signal", "trade"], rules: ["短板导向但不连续打击同一维度", "每个危机至少一条保守恢复路径", "无人在线暂停结算", "自给率提升后迁移事件池"] },
      pacing_model: { baseline: "经营1-2与每2-3周期一次小危机", escalation: "每5-7周期一次有预警的3-4级危机", recovery: "危机关闭后提供建设回报和至少一个安全周期" },
      recovery_model: { failure: "转入伤员救治、设施修复或债务型资源任务", deviation: "把新方案映射到台账与依赖后再裁决", deadlock: "开放低收益安全搜集或 NPC 技术建议" },
      settlement: { authority: "server_validated_host", deterministic_fields: ["resources", "facility_condition", "production_queue", "health", "fatigue"], dependency_graph: { fuel: ["generator"], generator: ["power"], power: ["water_filter", "greenhouse"], water_filter: ["water", "greenhouse"] }, random_policy: "bounded_risk_table_with_logged_inputs" },
    },
  },
  {
    slug: "liminal-backrooms",
    name: "失序回廊",
    category: "异常探索",
    templateId: "anomaly-director",
    description: "进入持续变化的后室式异常空间，用标记、录音、规则实验和救援让陌生玩家共同绘出逃生图。",
    premise: "某些门会把 Character 带进一片没有出口记录的失序空间：潮湿黄墙、重复灯声、错位楼梯和只在特定条件出现的门。这里没有预设主角；所有人的标记、录音、失踪记录和验证结果共同构成世界。",
    objective: "勘察一个边界明确的区域，验证一条异常规则，回应一位真人留下的记录，或建立一个让后来者更安全的锚点。",
    loop: "选择已知锚点与探索目标，观察环境并留下可验证记录，控制暴露与补给，验证异常规则或撤退，再更新公共地图和救援机会。",
    tension: "空间不确定性、信息可信度、暴露风险、有限补给和是否相信前人记录之间的取舍。",
    progression: "从入口层的个人求生，推进到稳定锚点、区域规则、跨层路线和由多人共同完成的失踪者救援与出口实验。",
    stateKey: "backrooms",
    state: {
      phase: "入口层勘察",
      stable_anchors: [{ id: "service-door-a", label: "A号维修门", stability: 80 }],
      mapped_zones: { yellow_corridor: { status: "partial", risk: 1 } },
      public_markers: [],
      recordings: [],
      rule_claims: [{ id: "knock-interval", claim: "墙后敲击可能每七秒重复", status: "unverified", confirmations: 0 }],
      missing_characters: [],
      threat_level: 1,
      open_routes: ["A号维修门 → 黄色回廊"],
    },
    memberKey: "wanderer",
    member: { condition: "stable", exposure: 0, supplies: { light: 6, water: 3, chalk: 5 }, equipment: ["记录器"], private_notes: [], verified_rules: [], route_memory: [], rescue_commitments: [] },
    initialThreads: [
      { id: "knock-interval", scope: "shared-experiment", state: "unverified", beat: "second-observation" },
      { id: "door-b12", scope: "exploration", state: "rumored", beat: "locate-marker" },
    ],
    rules: [
      "Host 区分已观察事实、玩家记录、规则假说与已验证规律；地图和异常规则只能由可复核行动推进，不能一句话发现出口。",
      "危险升级必须有可感知预兆与撤退窗口；失败造成迷路、暴露、补给损失或救援线程，不用无提示永久淘汰。",
    ],
    actions: [
      ["explore", "从锚点勘察区域", "action", "backrooms.explore_zone", "我从一个稳定锚点出发，声明方向、标记方式、补给预算和撤退条件，勘察一个有限区域。"],
      ["verify", "验证异常规则", "action", "backrooms.verify_rule", "我选择一条未确认规则，设计一次可撤回、可复核且有对照的验证。"],
      ["trace", "回应前人记录", "speech", "backrooms.respond_trace", "我查看其他真实玩家留下的标记、录音或求援记录，选择一条进行复核或续接。"],
    ],
    directives: [
      "每次探索给出锚点、方向、可感知细节、补给、暴露、撤退条件和记录结果，禁止无限制连续深入。",
      "异常规律在幕后保持一致；未验证记录可能错误但必须可通过交叉观察、对照实验或路线复走确认。",
      "优先让后来者遇到前人真实留下的标记与后果；NPC 只作为明确标识的失踪者、广播源或异常实体，不伪装成真人。",
    ],
    hostName: "回廊异常导演",
    hostRole: "narrator",
    tags: ["后室", "异常空间", "探索", "规则验证", "异步救援"],
    content: {
      director_abilities: [
        { id: "zone_composer", trigger: "bounded_exploration", effect: "依据已知地图和区域语法生成有限、可回退的探索片段" },
        { id: "rule_experiment", trigger: "verification_action", effect: "锁定实验条件、对照、观察结果和规则置信度" },
        { id: "trace_echo", trigger: "public_marker_or_recording", effect: "让后来者在合理位置遇到真实玩家留下的记录与后果" },
        { id: "rescue_weaver", trigger: "lost_or_missing", effect: "把失败转为带坐标、线索和窗口的异步救援线程" },
      ],
      thread_templates: [
        { id: "exploration-route", scope: "world", states: ["rumored", "scouted", "mapped", "anchored", "collapsed"] },
        { id: "rule-experiment", scope: "world", states: ["claim", "observed", "cross_checked", "verified", "disproved"] },
        { id: "rescue", scope: "member_and_world", states: ["missing", "signal_found", "route_open", "contact", "resolved"] },
      ],
      beat_library: [
        { id: "seven-second-knock", trigger: "inspect_yellow_corridor", scene: "灯管第三次闪烁后，墙内传来间隔近七秒的三次敲击", choices: ["记录十组间隔", "用不同节奏回应", "标记位置后撤退"], outcome: ["rule_confidence", "exposure", "recording", "route"], hook: "回应后的敲击似乎来自走廊另一端" },
        { id: "door-b12-marker", trigger: "follow_old_marker", scene: "一枚真实玩家留下的粉笔箭头指向编号 B12 的门，但旁边又有一条后来添加的警告", choices: ["核对两条记录时间", "远距离观察门缝", "留下新标记并寻找原记录者"], outcome: ["marker_reliability", "route", "social_trace"], hook: "门后录音提到一座蓝灯楼梯" },
      ],
      npc_cast: [
        { id: "radio-operator-17", name: "17号广播员", role: "明确标识的失踪 NPC", goal: "维持广播并找到稳定路线", tension: "信号可能延迟或来自旧记录" },
        { id: "maintenance-echo", name: "维修回声", role: "异常现象", goal: "重复特定维修流程", tension: "可预测但不具有人类意图" },
      ],
      event_generator: { inputs: ["current_anchor", "mapped_zones", "rule_claims", "exposure", "supplies", "recent_sensory_patterns", "public_traces"], pools: ["spatial_shift", "sound_pattern", "false_familiarity", "resource_cache", "signal", "entity_warning"], rules: ["新区域必须连接已知锚点", "每段探索有预算和撤退窗", "异常规律跨玩家保持一致", "优先续接真实公共痕迹", "近期感官套路去重"] },
      pacing_model: { baseline: "观察1→不安2→验证3→风险4→撤退或发现2", escalation: "暴露、补给与离锚距离共同驱动；不随机跳到致命强度", recovery: "回到锚点后整理记录、补给和回应他人痕迹" },
      recovery_model: { failure: "转为迷失状态、遗落记录或救援线程", deviation: "把自由行为映射为观察、实验、标记或移动", deadlock: "开放前人录音、环境对照或安全回撤路线" },
      settlement: { authority: "host_plus_locked_anomaly_rules", deterministic_fields: ["supplies", "exposure", "anchor_stability", "marker_reliability", "rule_confidence"], hidden_rule_policy: { mutable_after_first_observation: false, minimum_confirmations: 2, contradiction_requires_explanation: true } },
    },
  },
];

function choice(slug, [id, label, inputType, eventType, bodyText]) {
  return { id: `${slug}-${id}`, label, input_type: inputType, event_type: eventType, body_text: bodyText };
}

function buildOfficialWorld(config) {
  const id = `official-${config.slug}`;
  const choices = config.actions.map((action) => choice(config.slug, action));
  const worldStateKeys = ["world_progress", config.stateKey];
  const memberStateKeys = ["journey", config.memberKey];
  const specificRules = config.rules.map((rule, index) => `${index + 6}. ${rule}`).join("\n");
  return {
    id,
    slug: config.slug,
    shortcut: `/world ${config.slug}`,
    category: config.category,
    templateId: config.templateId,
    version: OFFICIAL_WORLD_VERSION,
    name: config.name,
    description: config.description,
    tags: ["官方", config.category, ...config.tags],
    rules: `${COMMON_RULES}\n\n【${config.name}专属玩法规则】\n${specificRules}`,
    definition: `${config.premise}\n\n核心循环：${config.loop}\n核心张力：${config.tension}\n长期成长：${config.progression}\n\n这个世界不预设主角。无论当前有 0、1 个还是很多真人在线，Host 都必须维持一个可加入、可完成、可留下后续影响的共享事件。`,
    entryPrompt: `Host 会先说明当前局势、与你有关的开放线程、其他成员最近留下的影响，以及一个无需补完历史的入口。${config.objective}`,
    hostPrompt: [
      `核心目标：${config.objective}`,
      `导演循环：${DIRECTOR_LOOP.join(" -> ")}`,
      `专属要求：${config.directives.join("；")}`,
      "必须从结构化线程、Beat、NPC、事件生成器、节奏和恢复模型中选择或组合内容；不得只做宽泛续写。",
      "每轮输出当前场景、玩家意图、裁决依据、结果与代价、状态变化、新事实和二至三个下一步。",
      `世界状态只允许写入：${worldStateKeys.join("、")}；成员状态只允许写入：${memberStateKeys.join("、")}。`,
    ].join("\n"),
    initialState: {
      world_progress: { phase: "起步", public_progress: 0, open_threads: config.initialThreads, recent_changes: [], next_event_seeds: [] },
      [config.stateKey]: config.state,
    },
    initialMemberState: {
      journey: { stage: "new", completed_actions: 0, discoveries: [], open_goals: [], last_thread_id: null },
      [config.memberKey]: config.member,
    },
    host: {
      name: config.hostName,
      agentKind: "host",
      worldRole: config.hostRole,
      participationPolicy: PARTICIPATION_POLICY,
      evolutionPolicy: EVOLUTION_POLICY,
      capabilities: ["guide", "inhabit", "facilitate", "coordinate", "judge", "advance", "remember", "recap"],
      personaText: `你是${config.name}的长期导演和唯一状态裁决者。持续为每位进入者组织具体可互动的场景，同时维护多人共同创造的事实、边界与后果。`,
      speakingStyle: "具体、简洁、有画面感；先给可行动的现在，再说明依据、影响与下一步。",
      judgementPolicy: {
        rule_priority: ["platform_safety", "world_rules", "character_agency", "state_consistency"],
        invalid_input: "reject_or_clarify",
        conflicts: "deterministic_then_escalate",
        state_writes: "referee_only",
        state_patch_policy: "host_derived",
        director_loop: DIRECTOR_LOOP,
        population_policy: POPULATION_POLICY,
        npc_policy: { ...NPC_POLICY, cast: config.content.npc_cast },
        world_mechanics: {
          family: config.templateId.replace(/-director$/u, ""),
          core_loop: config.loop,
          core_tension: config.tension,
          progression: config.progression,
          host_directives: config.directives,
          action_catalog: choices,
          director_abilities: config.content.director_abilities,
          thread_templates: config.content.thread_templates,
          beat_library: config.content.beat_library,
          event_generator: config.content.event_generator,
          pacing_model: config.content.pacing_model,
          recovery_model: config.content.recovery_model,
          settlement: config.content.settlement,
          state_contract: { world_top_level_keys: worldStateKeys, member_top_level_keys: memberStateKeys },
        },
      },
      memoryPolicy: {
        scope: "world",
        retain_events: true,
        retain_state_history: true,
        cross_world_memory: false,
        information_partitions: [
          { id: "public-world", visibility: "world", contains: worldStateKeys },
          { id: "member-journey", visibility: "actor", contains: memberStateKeys },
          { id: "host-private", visibility: "managers", contains: ["sealed_truths", "locked_anomaly_rules", "generator_history"] },
        ],
        return_strategy: "recap_change_then_restore_or_offer_hook",
      },
      outputSchema: {
        required: ["decision", "reason_text", "outcome_text", "new_facts", "opened_hooks"],
        decisions: ["accepted", "rejected", "clarification", "escalated"],
      },
      modelConfig: { mode: "platform_default" },
      toolAllowlist: [],
      onboardingPolicy: {
        welcome_text: config.premise,
        setup_prompt: config.objective,
        solo_message: "当前没有其他真人在线也可以完成完整玩法循环；Host 会扮演必要 NPC，但不会伪造真人玩家。",
        solo_objective_text: config.objective,
        solo_choices: choices,
        starter_choices: choices,
        free_input_prompt: "也可以直接描述你现在想尝试的一个行动。",
      },
      facilitationPolicy: {
        objective_text: config.objective,
        next_actions: choices,
        free_input_prompt: "可以继续当前目标，也可以提出一个符合世界规则的新尝试。",
        director_loop: DIRECTOR_LOOP,
        population_policy: POPULATION_POLICY,
        content_loop: {
          maintain_open_threads: true,
          min_player_relevant_hooks: 1,
          min_public_followups: 1,
          selection_order: ["continue_real_player_consequence", "continue_open_thread", "instantiate_beat", "generate_bounded_event"],
          repetition_guard: "同一场景、冲突或参与方式连续出现两次后必须改变地点、阻力、角色或后果。",
          refinement_signal: "记录玩家回避、重复追问、未完成目标、无效选项、内容重复与高回应内容，用于下一轮世界补全。",
        },
      },
      recapPolicy: { enabled: true, max_events: 8 },
      proactivity: "active",
    },
  };
}

export const OFFICIAL_WORLDS = WORLDS.map(buildOfficialWorld);

export const OFFICIAL_WORLD_BY_ID = new Map(OFFICIAL_WORLDS.map((world, index) => [world.id, { ...world, index }]));

export const OFFICIAL_WORLD_BY_SLUG = new Map(OFFICIAL_WORLDS.map((world) => [world.slug, world]));
