import { OFFICIAL_ENGLISH_WORLDS } from "./official-worlds-en.js";

export const OFFICIAL_WORLD_VERSION = 7;

export const OFFICIAL_WORLD_CATEGORIES = [
  "公共社交",
  "任务冒险",
  "悬疑推理",
  "生存经营",
  "异常探索",
  "Cozy social",
  "Cooperative mystery",
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
  zero_players: "暂停资源消耗、个人风险和自由叙事推进，保留开放线程与到期事件；下一位进入时只结算已经排期或由既有行动必然造成的变化。",
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

const PLAYER_EXPERIENCE_POLICY = {
  principle: "先让玩家在意正在发生的事，再逐步解释世界与规则。",
  opening: [
    "以一个正在发生、会因玩家选择而变化的具体场景开场",
    "先说明现在发生了什么、为什么值得管、玩家的行动可能改变什么",
    "首轮只保留一个当前目标和二至三个差异明确的行动方向",
  ],
  language: [
    "使用日常中文；首次出现的虚构名词必须能从上下文直接理解",
    "不得向玩家展示线程、Beat、状态机、Truth Package、置信度、暴露值等内部术语",
    "等级、台账和数值只在影响选择或玩家主动询问时说明",
  ],
  response_order: ["发生了什么", "玩家行动得到的反馈", "造成的具体变化", "接下来可做什么"],
  information_budget: {
    first_turn_max_proper_nouns: 3,
    first_turn_max_choices: 3,
    one_immediate_objective: true,
    no_table_on_entry: true,
  },
  motivation_required: {
    minimum_signals: 2,
    signals: ["具体的人或地方", "不行动的后果", "值得追问的未知", "行动后可见的变化"],
  },
  choice_style: "使用‘动词 + 对象’描述行动，选项必须代表不同方法或价值取舍；始终允许自由行动。",
};

const ASYNC_CONTINUITY_POLICY = {
  priority: "异步影响优先于伪造同时在线的热闹。",
  layers: {
    trace: "留下可被后来者直接看到的物品、记号、档案、修复或建设",
    state: "改变同一份公共世界状态，让后来者进入一个已经不同的世界",
    narrative: "由世界内人物、记录或环境具体转述前人的影响",
  },
  idle: "最后一名玩家离开后暂停消耗与自由推进；再次激活时，仅结算已排期事件和既有行动的确定后果，不制造离线惩罚。",
  requirements: [
    "每个被接受的公共行动至少形成痕迹、状态或叙事影响中的一种",
    "未完成与失败也可以成为后来者可修复、可纠正或可接续的处境",
    "异步影响只修改世界，不替其他真人玩家表态、行动或消耗私人状态",
  ],
};

const COLLECTIVE_DECISION_POLICY = {
  independent: "日常、局部、可逆行动允许单人完成并立即反馈。",
  npc_role: "NPC 可以表达立场并执行其职责，但不计作真人玩家的同意或法定人数。",
  collective: "影响全体真人成员、长期公共资产或不可逆方向的决定，必须使用有截止、法定人数和分歧处理的集体窗口。",
  fallback: "人数不足时允许采取临时、可逆的维持方案，并保留正式议题。",
};

const WORLDS = [
  {
    slug: "center-town",
    name: "晨雾镇",
    category: "公共社交",
    templateId: "social-director",
    description: "走路半个钟头能绕一圈的小镇。你在这里住下来、认识人，也让自己做过的事留在镇上的日子里。",
    premise: "晨雾镇不大，雾只在清晨有。镇上有一条河、一条主街、一座小火车站和一间周四不开门的面包房。你只是一个拎着箱子下车的新居民；这里不缺故事，缺的是愿意住下来的人。",
    objective: "先在抵达当天认识一个人、帮上一件小忙，或者为自己的住处找到一个可靠线索。",
    loop: "住下来，过自己的日子；小镇回应你的习惯、承诺和选择，你逐渐有了熟人和位置，镇上的事也开始自然找上你。",
    tension: "个人生活、邻里边界、旧传统与公共需要之间的分寸。",
    progression: "从下火车的外乡人，变成拥有住处、工作、熟人和自己生活节奏的居民，最终能够牵头一件大家真正愿意响应的事。",
    stateKey: "town",
    state: {
      season: "春",
      day: 1,
      weather: "薄雾",
      prosperity: 20,
      districts: { station: "open", market: "open", old_mill: "open", north_watch: "locked" },
      notices: ["布告栏上贴着空屋出租、邮差招人搭把手和周末河滩集市三张纸条"],
      social_traces: [],
      community_projects: [{ id: "spring-market", title: "修复河岸集市", progress: 0, target: 12 }],
      proposals: [],
      resident_routines: { bakery_closed_day: "周四", tea_shop: "每日傍晚最热闹", post_route: "上午" },
      shared_places: { notice_board: [], tea_shop: [], station: [], old_mill: [] },
    },
    memberKey: "resident",
    member: { home: null, occupation: null, relationships: {}, reputation: 0, contributions: 0, commitments: [] },
    initialThreads: [
      { id: "arrival-rain", scope: "member", state: "open", beat: "wet-letters" },
      { id: "mill-future", scope: "world", state: "open", beat: "mill-roof" },
      { id: "postman-route", scope: "world", state: "open", beat: "needs-a-hand" },
    ],
    rules: [
      "住所、店铺、职位与关系必须通过实际行动逐步取得；私人空间只有本人或受邀者能够进入。",
      "公共设施和活动按可验证贡献推进；关系变化基于真实互动，个人不能宣称其他居民已经参加或同意。",
    ],
    actions: [
      ["daily-life", "帮邮差捡起湿信", "action", "town.daily_event", "我先帮老邮差把散在站台上的信捡起来，看看哪些已经被雨打湿。"],
      ["social-trace", "去茶铺坐一会儿", "speech", "town.respond_trace", "我跟着茶铺老板娘进去坐坐，问问镇上哪里能住，也听听今天发生了什么。"],
      ["community", "看看布告栏", "action", "town.community_project", "我查看站台布告栏上的三张新纸条，选择一件今天能搭把手的事。"],
    ],
    directives: [
      "首访从抵达当日的一件生活小事开始：有人在场、有事可做，也有找住处的线索；不以神秘物件强行制造主线。",
      "玩家不是领取任务，而是在生活中撞见人和事；每轮优先给一个具体人物会回应的低压力入口。",
      "把真实玩家的留言、物品、承诺和公共贡献转化为邻里回声，不用 NPC 伪造热闹。",
      "小镇变化由玩家行动、已排期节庆和已有后果推进；无人时不凭空演完重要事件。",
    ],
    hostName: "晨雾镇导演",
    hostRole: "steward",
    tags: ["家园", "日常", "异步社交", "成长"],
    content: {
      director_abilities: [
        { id: "daily_rhythm", trigger: "entry_or_due_event", effect: "根据天气、居民日程和开放事情生成一件自然发生的生活入口" },
        { id: "word_gets_around", trigger: "accepted_public_action", effect: "把真人行动变成物件变化、居民转述和关系回声" },
        { id: "season_hands", trigger: "scheduled_milestone", effect: "以河汛、集市、收获和寒潮推进季节公共事情" },
      ],
      thread_templates: [
        { id: "season-project", scope: "world", states: ["open", "progressing", "closing", "archived"] },
        { id: "resident-life", scope: "member", states: ["invitation", "commitment", "payoff"] },
        { id: "town-issue", scope: "world", states: ["noticed", "discussed", "proposed", "decided", "remembered"] },
      ],
      beat_library: [
        { id: "wet-letters", trigger: "entry_or_arrival_rain", scene: "你下火车时雨刚停。老邮差在站台上摔了一跤，一袋信散进水洼；茶铺老板娘一边帮他捡，一边问你今晚有地方住没有", choices: ["先捡湿信", "扶邮差去歇着", "问老板娘空屋在哪"], outcome: ["relationship", "home_lead", "public_trace"], hook: "其中一封没有署名的旧信寄给老磨坊管理员，邮戳日期却比袋里其他信早了半年" },
        { id: "mill-roof", trigger: "mill_future_or_passing_by", scene: "老磨坊屋顶漏雨，管理员在梯子上喊你搭把手；街对面的杂货铺老板却说，这钱不如留着建仓库", choices: ["帮忙补屋顶", "听听两边怎么说", "提出一个临时共用办法"], outcome: ["relationships", "mill_condition", "public_position"], hook: "你的做法会被写上布告栏，后来者可以支持、反对或继续完善" },
        { id: "needs-a-hand", trigger: "postman_route_or_morning", scene: "上午的邮路比平时晚了半个钟头。老邮差把一捆河对岸的信压在柜台上，说今天腿实在抬不起来，但每户都在等消息", choices: ["替他送近处三封信", "先重排今天的邮路", "问镇民谁愿意接力"], outcome: ["commitment", "relationship", "public_trace"], hook: "送信途中会发现一户地址已经变更，需要后来者继续确认去向" },
      ],
      npc_cast: [
        { id: "tea-owner", name: "茶铺老板娘", role: "店主", goal: "让人有地方坐下把话说完", tension: "什么都知道但不替人传话" },
        { id: "old-postman", name: "老邮差", role: "邮差", goal: "把每封信亲手送到", tension: "腿越来越不听使唤，嘴上不肯认" },
        { id: "mill-keeper", name: "磨坊管理员", role: "管理员", goal: "让老磨坊继续有用", tension: "把拆除建议听成对旧日子的否定" },
        { id: "grocer", name: "杂货铺老板", role: "商户", goal: "给集市扩一间仓库", tension: "账算得清楚，却低估了人对地方的感情" },
      ],
      event_generator: { inputs: ["season", "weather", "resident_routines", "open_threads", "recent_changes", "player_stage"], pools: ["daily_help", "relationship", "money", "season", "public_issue"], rules: ["符合小镇常识", "至少一个本轮可收束入口", "只续接已由公开事件确认的真人痕迹", "不连续制造秘密"] },
      pacing_model: { baseline: "大多数是顺手小事与关系回声", escalation: "已排期的集市、镇会和天气事件才进入公共强度", recovery: "公共事件后回到生活、关系与结果被议论的日子" },
      recovery_model: { failure: "转为修复委托或关系补偿", deviation: "保留自由行动并连接最近开放线程", deadlock: "注入一条公开邀请和一件单人日常" },
      settlement: { authority: "host", deterministic_fields: ["reputation", "contributions", "prosperity", "project_progress"], collective_fields: ["proposals", "world_projects"] },
    },
  },
  {
    slug: "adventurers-guild",
    name: "风口集",
    category: "任务冒险",
    templateId: "quest-director",
    description: "商道夹在两座山之间，活计把人带进山里。你经营的不是等级，而是走通过的路和别人敢不敢把命交给你。",
    premise: "风口集只有十几户人家、一间客栈、一间铁匠铺和一座货栈。春秋商队翻山，冬天大雪封路。你是刚落脚的外乡人；集上是岸，山里才是海。护送、寻人、探路和抢险都从真实生计里长出来。",
    objective: "抵达当天就接住一件正在发生的山路麻烦，做出第一次会被集上人记住的判断。",
    loop: "从具体的人手里揽活，准备后进山，在天气、路线和人命之间作选择；回集交代、养伤和听消息，再沿自己或前人留下的记号走得更深。",
    tension: "近路与稳路、货物与人命、眼前生计与山中旧事，以及是否相信前人的记号。",
    progression: "从能搭把手的外乡人，变成认路、守诺、有人愿意托付的山里人；能够领商队、开新路，并决定旧矿道与商路的未来。",
    stateKey: "adventure",
    state: {
      season: "开山期",
      guild_level: 1,
      guild_funds: 20,
      facilities: { hall: 1, forge: 0, intelligence_room: 0 },
      quest_board: [{ id: "storm-caravan", title: "暴雨前让商队过河", rank: "入门", status: "open", stages: ["accept", "prepare", "challenge", "return"] }],
      known_locations: { market_road: "熟路", red_pass: "半通", old_mine: "封闭", abandoned_village: "传闻" },
      expedition_records: [],
      resonance_fragments: 0,
      caravan_schedule: { current: "春季商队已到河边", next: "三日后封闭红风口" },
      public_marks: [],
      mountain_log: [],
      jobs: [{ id: "storm-caravan", patron: "商队头子", stake: "二十车盐和药材", status: "urgent" }],
    },
    memberKey: "adventurer",
    member: { rank: "外乡人", specialties: [], inventory: ["旧雨披", "短绳", "两份干粮"], active_quests: [], completed_quests: [], contribution: 0, bonds: {}, standing: "刚落脚", injuries: [], promises: [], routes_walked: [] },
    initialThreads: [
      { id: "storm-caravan", scope: "quest", state: "open", beat: "bridge-rope" },
      { id: "old-mine", scope: "world", state: "rumored", beat: "rain-opened-gap" },
      { id: "lost-cargo", scope: "world", state: "open", beat: "pass-trouble" },
    ],
    rules: [
      "揽下的活必须有交代；路线、天气、伤势、托付和酬劳都有来源，不能凭空完成或获得。",
      "前人的记号、套子、货物和发现不得擅自抹掉或据为己有；真人可自愿搭伙，离线同伴不会被 Host 自动控制。",
    ],
    actions: [
      ["quest", "先固定过河绳", "choice", "adventure.accept_quest", "我去帮河边商队固定过河绳，先让人和头车安全过桥。"],
      ["prepare", "寻找失踪的驮马", "action", "adventure.prepare", "我沿对岸新鲜蹄印寻找失踪驮马，同时给自己留下能返回的记号。"],
      ["explore", "带商队走旧山路", "action", "adventure.advance_quest", "我向老向导问清旧山路的险处，判断能否在暴雨前带商队绕过去。"],
    ],
    directives: [
      "首访当天直接发生护送、救援、抢险或山路意外，不用连续零工拖延到真正冒险。",
      "主轴在山里：任务题材轮换护送、寻人、探路、抢险、采猎和陌生人偶遇；旧矿难只是背景长线。",
      "所有任务在内部使用接取、准备、挑战、结果、余波状态机，并允许玩家从仍开放的节点旁路加入。",
      "每轮用天气、路况、伤势和人的反应说明风险，不展示等级、难度或掉落表。",
      "失败产生情报、消耗、伤势或新风险，同时保证存在撤退、求援、改装或降级任务的恢复路径。",
    ],
    hostName: "风口集导演",
    hostRole: "narrator",
    tags: ["山野冒险", "商队", "探索", "异步路线", "成长"],
    content: {
      director_abilities: [
        { id: "work_finds_people", trigger: "entry_or_job_closed", effect: "从商队、生计、天气和人物托付中生成具体活计" },
        { id: "mountain_moves", trigger: "quest_action_or_due_event", effect: "让路况、天气、野兽和旧记号按既有状态回应" },
        { id: "return_and_account", trigger: "quest_resolved", effect: "结算交代、伤、酬劳、集上态度和公共山路记录" },
      ],
      thread_templates: [
        { id: "commission", scope: "member_or_party", states: ["open", "accepted", "prepared", "challenging", "returning", "resolved"] },
        { id: "region-arc", scope: "world", states: ["rumored", "charted", "stabilized", "transformed"] },
        { id: "shared-route", scope: "world", states: ["rumored", "marked", "walked", "trusted", "changed"] },
      ],
      beat_library: [
        { id: "bridge-rope", trigger: "entry_or_storm_caravan", scene: "你刚到风口集，暴雨就把河上的木桥冲歪。二十车盐和药材堵在对岸，桥索只剩一根，另有一匹驮马受惊跑进山沟", choices: ["先固定桥索", "去找驮马", "问老向导能否绕山"], outcome: ["job_stage", "route", "time", "standing"], hook: "对岸桥墩上有一枚来源不明的旧绳结，是否还能承重需要现场复核" },
        { id: "rain-opened-gap", trigger: "old_mine_or_heavy_rain", scene: "秋雨把封了二十年的矿道口冲开一角，里面水声不对；货栈老板肯出钱，老向导却只说进去要带两盏灯", choices: ["先测水和风", "问清两盏灯的缘故", "留下公开记号再进"], outcome: ["route", "injury_risk", "mountain_log", "old_case_clue"], hook: "洞壁刻字能被后来者描录、解释或纠正" },
        { id: "pass-trouble", trigger: "lost_cargo_or_red_pass", scene: "红风口下方散着三只破木箱，车辙在碎石坡上突然中断。货主只认货不认人，山脚却有人看见一名脚伤的赶车人往背风沟走", choices: ["先找伤员", "封存散落货物", "沿车辙确认事故位置"], outcome: ["rescue", "cargo_record", "route_risk", "standing"], hook: "找回的人和货可能指向两条不同的后续托付" },
      ],
      npc_cast: [
        { id: "innkeeper", name: "客栈老板娘", role: "客栈老板", goal: "让每件托付都找到肯负责的人", tension: "记得所有人的账，只说一半消息" },
        { id: "old-guide", name: "瘸腿马", role: "老向导", goal: "把真正认路的人教出来", tension: "知道不能走的路，却不轻易解释" },
        { id: "hunter-lei", name: "老雷", role: "猎户", goal: "守住山里规矩和矿难遗属的体面", tension: "对旧矿道和外乡人都不信任" },
        { id: "warehouse-owner", name: "货栈老板", role: "商人", goal: "让商路不断、货物有价", tension: "总想把山里的东西先换算成钱" },
      ],
      event_generator: { inputs: ["season", "known_locations", "caravan_schedule", "public_marks", "recent_jobs", "party_size"], pools: ["escort", "rescue", "pathfinding", "weather_emergency", "hunting", "stranger_encounter"], rules: ["活计来自具体人物与生计", "首轮即可开始实质行动", "每项有单人路径与撤退条件", "旧事不连续喧宾夺主"] },
      pacing_model: { baseline: "集上揽活→进山升压→作出取舍→回集交代", escalation: "随路况、天气和离集距离上升，不随抽象等级", recovery: "高风险后安排养伤、修具、闲谈和公共记号整理" },
      recovery_model: { failure: "保留情报并生成救援、修理或补给任务", deviation: "把自由探索登记为临时委托", deadlock: "降低目标规模或开放替代路线" },
      settlement: { authority: "host_plus_rules", deterministic_fields: ["inventory", "injuries", "standing", "routes_walked", "public_marks", "job_stage"], random_policy: "bounded_weather_route_table_with_logged_inputs" },
    },
  },
  {
    slug: "city-detective-agency",
    name: "钟楼巷 19 号",
    category: "悬疑推理",
    templateId: "mystery-director",
    description: "楼下是裁缝铺，楼上是事务所，阁楼有一箱十五年没人动过的卷宗。小案子会把城市紧闭的门一扇扇打开。",
    premise: "钟楼巷 19 号在北桥城老城区。师傅病倒后，你和其他调查员接手事务所：找猫、寻人、欠款和家事都可以上门。十五年前白渡口沉了一条船，七个人没回来；真相没有消失，只是分别藏在仍然生活于此的人心里。",
    objective: "先把一件小案子查出一个有来源的事实，获得继续问下去的由头，而不是急着指认答案。",
    loop: "接一件具体小案，跑现场、问人、翻旧纸并结案；其中一些案件会碰到旧案的人名、地点或物件，让同一份公共卷宗逐渐被读懂。",
    tension: "真相固定而人各有难处；问得太急会关门，结论下得太早会伤害无辜者。",
    progression: "从查清街坊小事、获得人情和由头开始，逐步推进白渡口旧案；旧案结案后进入余波与下一季城市案件，事务所不会随一案结束。",
    stateKey: "mystery",
    state: {
      district: "北桥城",
      active_cases: [{ id: "missing-cat", title: "白渡口对门的猫", difficulty: 1, status: "intake", truth_commitment: "pending_seal" }],
      public_evidence: [],
      testimony: [],
      hypotheses: [],
      contradictions: [],
      case_archive: [],
      arc_clues: [],
      case_season: { id: "white-ferry", title: "白渡口沉船案", state: "dormant", successor_policy: "aftermath_then_new_season" },
      reasons_to_ask: [],
      doors: {},
    },
    memberKey: "detective",
    member: { role: null, credibility: 50, tools: ["相机", "手套", "记录本"], contacts: {}, private_notes: [], verified_clues: [], open_assignments: [] },
    initialThreads: [
      { id: "missing-cat", scope: "case", state: "intake", beat: "missing-cat-wharf" },
      { id: "white-ferry", scope: "world-arc", state: "dormant", beat: "page-seventy-three" },
      { id: "why-master-stopped", scope: "world-arc", state: "hidden", beat: "blank-page" },
    ],
    rules: [
      "每案开启前必须在幕后锁定真相；Host 区分亲见、纸面记录、听闻和推测，不能因玩家猜中关键词而改写答案。",
      "关键结论至少有两条可复核证据路径；错误指控会影响信用和时效，但案件始终保留复查、补证或重开的恢复路径。",
      "问话、调档和上门需要来自案件、人情或记录的合理由头；由头限制信息，不限制玩家自由行动。",
    ],
    actions: [
      ["scene", "问清猫的习惯", "action", "mystery.investigate_scene", "我先问老太太这只猫平时去哪、怕什么，以及最后一次看见它的时间。"],
      ["verify", "去白渡口找猫", "action", "mystery.verify_clue", "我沿猫常走的巷子去白渡口，先找猫，也留意现场有什么不合常理。"],
      ["theory", "翻阁楼旧卷宗", "speech", "mystery.propose_hypothesis", "我把渡口发现的刻痕描下来，回事务所查旧卷宗里是否出现过相同记号。"],
    ],
    directives: [
      "新案件先在幕后密封真相、时间线、证据图和可排除的巧合；玩家只看到人、地方、纸和门是否愿意打开。",
      "小案必须能独立成立；约三分之一自然碰到当季长案的边，禁止每案都强行服务同一主线。",
      "每轮给出具体可观察细节、信息来源和至少一个深入方向；用日常语言指出矛盾，不向玩家展示证据分类和信誉数值。",
      "多人可分工现场、档案、证人与时间线；Host 合并事实但保留彼此冲突的推论，不投票决定真相。",
    ],
    hostName: "北桥调查导演",
    hostRole: "narrator",
    tags: ["城市悬疑", "小案", "旧案", "共同推理", "异步档案"],
    content: {
      director_abilities: [
        { id: "truth_sealer", trigger: "case_created", effect: "开放案件前锁定真相、时间线、证据路径与可排除巧合" },
        { id: "reason_opens_door", trigger: "investigation_action", effect: "按案件由头、人情、地点和前置事实决定谁肯说什么" },
        { id: "case_touches_history", trigger: "case_progress", effect: "让部分小案自然碰到当季长案的人名、地点或旧物" },
      ],
      thread_templates: [
        { id: "case", scope: "world", states: ["intake", "investigating", "theory", "conclusion", "aftermath", "archived"] },
        { id: "contact", scope: "member", states: ["unknown", "cooperative", "trusted", "broken"] },
        { id: "case-season", scope: "world", states: ["dormant", "stirring", "investigating", "conclusion", "aftermath", "succeeded"] },
      ],
      beat_library: [
        { id: "missing-cat-wharf", trigger: "entry_or_missing_cat", scene: "白渡口对门的老太太上楼找猫。她反复说猫从不往水边去；今天猫碗旁却有湿脚印，一直通向封了十五年的旧栈桥", choices: ["问清猫的习惯", "沿湿脚印去渡口", "查看老太太家旧照片"], outcome: ["evidence", "reason_to_ask", "relationship"], hook: "旧栈桥木桩上刻着七个短横，后来加入的调查员也可以接着查它的来历" },
        { id: "page-seventy-three", trigger: "wharf_mark_or_archive", scene: "阁楼卷宗第七十三页画着相同的七个短横，第七十四页却被整齐撕掉；师傅当年的调查正停在这里", choices: ["查谁借过卷宗", "去报社找旧报道", "等周三问桥头更夫"], outcome: ["archive", "reason_to_ask", "door_state"], hook: "后来者可以从任一路径继续，而真相不会随选择改变" },
        { id: "blank-page", trigger: "why_master_stopped_or_missing_page", scene: "师傅的私人索引里，第七十四页对应的位置只写了一个日期和‘先别问她’四个字。墨水与十五年前卷宗一致，但‘她’没有姓名", choices: ["核对当日委托记录", "比较师傅其他笔迹", "先查谁能接触索引"], outcome: ["provenance", "reason_to_ask", "sealed_truth_progress"], hook: "任何新推论都先记为假说，直到出现第二条独立证据路径" },
      ],
      npc_cast: [
        { id: "tailor-landlady", name: "裁缝铺老板娘", role: "房东", goal: "让巷里的事有个体面说法", tension: "什么都看见，却只顺口提一句" },
        { id: "old-reporter", name: "报社老记者", role: "记者", goal: "补上十五年没敢登的报道", tension: "留着信，也留着怕" },
        { id: "young-officer", name: "派出所小警察", role: "警方联络", goal: "把事情查清又不砸自己的饭碗", tension: "想帮忙，但每扇档案门都要由头" },
        { id: "bridge-watchman", name: "桥头更夫", role: "旧案知情人", goal: "让那晚过去又无法真正忘记", tension: "清醒时什么都不认" },
      ],
      event_generator: { inputs: ["case_type", "district", "reasons_to_ask", "doors", "case_season", "recent_cases", "credibility"], pools: ["missing", "debt", "family", "property", "employment", "old_case_ripple"], rules: ["真相先于场景锁定", "小案多数独立成立", "当季旧案只以人名地点旧物自然带边", "关键结论至少两条路径"] },
      pacing_model: { baseline: "接案1→发现2→矛盾3→逼近4→结论3→余波1", escalation: "证据缺口与时效共同驱动，禁止无预警强行倒计时", recovery: "结案或误判后提供档案整理与关系修复" },
      recovery_model: { failure: "错误结论转入补证或重开，不改写真相", deviation: "把无关调查记录为城市传闻，明确与当前案件的证据距离", deadlock: "开放第二证据路径或可申请的工具与人脉" },
      settlement: { authority: "host_plus_sealed_truth", truth_package: { required: true, mutable_after_open: false, storage: "host_private_partition", public_commitment: true }, evidence_classes: ["physical", "testimony", "record", "inference", "red_herring"] },
    },
  },
  {
    slug: "apocalypse-shelter",
    name: "白河电站",
    category: "生存经营",
    templateId: "survival-director",
    description: "八个人守一座山中老电站过冬。煤、冻管、夜班和山下三百户人家的灯，每一项都落到具体的人身上。",
    premise: "白河电站在山里，下山要四个小时，冬天一封就是四个月。站上有一台老水轮机、一台舍不得开的柴油机、一窖土豆和八个守站人。你是新来的；老站长说，在这里最金贵的不是电，是人。",
    objective: "先接住今晚的一次供电请求，弄清它会消耗什么、影响谁，并完成一个可逆的当班决定。",
    loop: "看天、看煤、看机器也看人；分班、巡检、供电和修理，扛过具体故障与请求，数着节气走到开春，再共同面对电站下一阶段的去留。",
    tension: "煤、人、机器和山下需要同时拉扯；每个正确选择都可能把代价推给另一个人。",
    progression: "第一季守过封山九十日；之后进入开春去留、汛期保站、新电网接入与下一冬准备，使电站持续成为共享世界。",
    stateKey: "settlement",
    state: {
      day: 1,
      resources: { food: 90, water: 100, medicine: 12, fuel: 8, power: 70, materials: 16, coal: 76, diesel: 10 },
      indicators: { safety: 60, morale: 55, sustainability: 30 },
      facilities: {
        turbine: { condition: 68, active: true, depends_on: ["pressure_pipe"] },
        diesel_generator: { condition: 75, active: false, depends_on: ["diesel"] },
        boiler: { condition: 72, active: true, depends_on: ["coal"] },
        pressure_pipe: { condition: 64, active: true, depends_on: ["inspection"] },
        radio: { condition: 80, active: true, depends_on: ["power"] },
      },
      production_queue: [],
      threats: [{ id: "coal-gap", level: 2, deadline: 60, status: "warned" }],
      collective_issues: [],
      external_map: { pressure_pipe_route: "known", lower_villages: "radio_contact", county_road: "snowed_in" },
      season_phase: { id: "winter-watch", day: 1, days_to_thaw: 90, next: "spring-decision" },
      duty_roster: [],
      village_requests: [{ id: "clinic-night-power", status: "incoming", deadline: "今晚" }],
    },
    memberKey: "operator",
    member: { role: "新守站人", health: 80, fatigue: 10, skills: {}, gear: ["棉大衣", "工作手套"], contribution: 0, trust: 50, commitments: [], shifts_worked: [], people_bonds: {} },
    initialThreads: [
      { id: "clinic-night-power", scope: "crisis", state: "warned", beat: "clinic-night-power" },
      { id: "coal-gap", scope: "world", state: "progressing", beat: "one-month-short" },
      { id: "station-future", scope: "world", state: "hidden", beat: "county-letter" },
    ],
    rules: [
      "煤、油、粮、药、班次和设备变化必须按公开台账结算来源、消耗与依赖；玩家先看到人和机器的反应，再看到相关账目。",
      "日常、局部、可逆的当班决定允许单人完成；永久停站、长期配给和公共方向必须进入真人集体议题，NPC 意见不计作真人法定人数。",
      "无人在线时暂停每日消耗和个人风险；再次进入只结算已有排期或前序行动必然造成的变化。",
    ],
    actions: [
      ["report", "回应卫生所", "action", "survival.handle_threat", "我先在无线电里问清卫生所今晚需要多少电、持续多久，以及不能供电会发生什么。"],
      ["produce", "核对今晚的煤和油", "action", "survival.production", "我和老站长核对今晚多供两小时电会消耗多少煤或柴油，以及明天谁要补这个缺口。"],
      ["expedition", "巡查机房", "choice", "survival.expedition", "我去听水轮机和锅炉的声音，确认今晚增供之前有没有必须先处理的故障。"],
    ],
    directives: [
      "首访从山下无线电的一次具体请求开始；先让玩家听见人，再解释煤、油和班次。",
      "每次裁决先说明行动改变了什么，再只显示与本次选择有关的资源、设施、风险和个人状态变化及原因。",
      "世界日按已结算班次和事件推进，不按现实离线时间扣资源；每个季节阶段结束后必须进入下一阶段，不让共享世界通关停摆。",
      "危机来自天气、机器、物资、人和山下请求，必须有预警、至少两个具体代价方案和恢复路径；不生成怪物或突袭奇观。",
    ],
    hostName: "白河守站导演",
    hostRole: "steward",
    tags: ["生存", "经营", "电站", "冬季", "班组", "共治"],
    content: {
      director_abilities: [
        { id: "station_watch", trigger: "entry_or_cycle", effect: "把天、煤、机器、人和山下请求组成一班具体的守站工作" },
        { id: "ledger_and_roster", trigger: "resource_or_shift_change", effect: "按设备依赖和班次结算，并转成谁的活重了、谁的眉头松了" },
        { id: "season_transition", trigger: "phase_milestone", effect: "从封山推进至开春去留、汛期、新电网和下一冬" },
      ],
      thread_templates: [
        { id: "crisis", scope: "world", states: ["warned", "active", "contained", "recovery", "closed"] },
        { id: "facility", scope: "world", states: ["noticed", "scheduled", "repairing", "operational", "failing"] },
        { id: "duty", scope: "member_or_party", states: ["offered", "assigned", "working", "relieved", "remembered"] },
        { id: "station-season", scope: "world", states: ["winter-watch", "spring-decision", "flood-season", "grid-transition", "next-winter"] },
      ],
      beat_library: [
        { id: "clinic-night-power", trigger: "entry_or_clinic_night_power", scene: "每天一次的无线电通话里，山下村医说今晚有位产妇情况不好，问电站能不能多供两小时电。多供意味着开柴油机，油本来要留给水轮机停摆时救急", choices: ["问清用电时段", "核对柴油台账", "先召集当班人定临时方案"], outcome: ["diesel", "power", "duty_roster", "village_relation"], hook: "事情结束后，山下会把结果和一件具体物品送回站上，成为后来者看得见的记忆" },
        { id: "pressure-pipe-walk", trigger: "inspection_due", scene: "连续降温后，老秦说两小时雪路外的压力钢管声音不对。巡检今天不去，明晚可能停机；去则需要两个人和一班体力", choices: ["跟老秦去", "先从机房测压力", "询问现场谁能搭伴"], outcome: ["pipe_condition", "fatigue", "skill", "public_trace"], hook: "老秦等巡检员沿雪路插下的旧木杆，能被后来者修正成更安全的巡检线" },
        { id: "one-month-short", trigger: "coal_gap_or_ledger_review", scene: "老范把煤仓尺子递给你：按现在的火力，煤会比开山日早一个月见底。降温、少烧和下山运煤都能补缺口，但代价会落在不同的人身上", choices: ["复核煤耗", "试算分时供暖", "查旧运煤路线"], outcome: ["coal_forecast", "duty_roster", "collective_issue"], hook: "先形成可逆的试行方案，长期配给必须进入真人集体议题" },
        { id: "county-letter", trigger: "station_future_or_spring_decision", scene: "老站长抽屉里压着县里的撤站征询函，要求开春前回复。它不会影响今晚供电，却决定下一季还有没有这支守站班组", choices: ["先核对函件期限", "整理电站贡献记录", "提出临时保站方案"], outcome: ["public_record", "proposal", "season_transition"], hook: "正式去留不能由一名成员或 NPC 单独决定" },
      ],
      npc_cast: [
        { id: "old-chief", name: "老站长", role: "站长", goal: "把班排平、账记清，让人都过完这个冬天", tension: "县里的撤站信压在桌下" },
        { id: "boiler-fan", name: "老范", role: "锅炉工", goal: "把手艺教给肯踏实学的人", tension: "咳嗽越来越重却不肯少值班" },
        { id: "electrician-feng", name: "小冯", role: "电工", goal: "让老机器多撑几年", tension: "夜里常去钟楼听不该出现的远台" },
        { id: "cook-xiaocui", name: "小翠", role: "炊事员", goal: "让大家每天还有一顿像样的饭", tension: "开春想下山，谁也没有资格拦" },
        { id: "inspector-qin", name: "老秦", role: "巡检员", goal: "让压力管和每个新人都认得雪路", tension: "腿伤遇冷就疼" },
      ],
      event_generator: { inputs: ["resources", "facilities", "season_phase", "duty_roster", "village_requests", "recent_events", "population"], pools: ["weather", "machine", "supplies", "people", "village_request", "season_transition"], rules: ["麻烦符合电站常识", "代价落到煤油班次和具体人物", "无人在线暂停消耗", "阶段完成后迁移事件池"] },
      pacing_model: { baseline: "日常班次与账目→一两天具体故障→节气喘息", escalation: "账面缺口、天气与设备预兆共同驱动", recovery: "危机后给饭桌、交班、学习手艺或山下回信" },
      recovery_model: { failure: "转入伤员救治、设施修复或债务型资源任务", deviation: "把新方案映射到台账与依赖后再裁决", deadlock: "开放低收益安全搜集或 NPC 技术建议" },
      settlement: { authority: "server_validated_host", deterministic_fields: ["resources", "facility_condition", "duty_roster", "health", "fatigue", "season_phase"], dependency_graph: { pressure_pipe: ["turbine"], turbine: ["power"], diesel: ["diesel_generator"], coal: ["boiler"], power: ["radio", "villages"] }, random_policy: "bounded_weather_machine_table_with_logged_inputs" },
    },
  },
  {
    slug: "liminal-backrooms",
    name: "失序回廊",
    category: "异常探索",
    templateId: "anomaly-director",
    description: "熟悉空间被错误拼接成无人之境。你沿前人的刻字和录音找路，也把未知区域写成后来者能接续的公共档案。",
    premise: "你从现实某个不该松动的墙角、楼梯或电梯里掉进一片错位空间。潮湿走廊、空停车场、旧办公室和设备间彼此相连，每个区域都有不解释自己但保持一致的规律。这里没有熟人社会，陌生玩家通过刻字、磁带、遗失物和救援记录彼此托付。",
    objective: "先确认退路、读懂眼前一条前人警告，并完成一次能被后来者复核的观察。",
    loop: "回到安全点或误入新区域，确认退路，观察与试探一条异常，验证或纠正前人记录，再把自己的发现写进同一份公共档案。",
    tension: "想知道真相、想帮助陌生人，也害怕自己离熟悉的出口越来越远。",
    progression: "从入口走廊的第一条可靠记录开始，逐步建立安全点、探明新区域、修正公共档案，并异步完成救援与跨区域通路；出口只是传说，世界目标是让这里逐渐可活。",
    stateKey: "backrooms",
    state: {
      phase: "入口层勘察",
      stable_anchors: [{ id: "service-door-a", label: "A号维修门", stability: 80 }],
      mapped_zones: { yellow_corridor: { status: "partial", risk: 1 } },
      public_markers: [],
      recordings: [],
      rule_claims: [{ id: "phone-after-third-ring", claim: "第三次铃响后接听可能改变走廊", status: "unverified", confirmations: 0 }],
      missing_characters: [],
      threat_level: 1,
      open_routes: ["A号维修门 → 黄色回廊"],
      documented_zones: [{ id: "yellow-corridor", name: "黄走廊", status: "初稿", access: "误入", exits: ["下行楼梯（未确认）"] }],
      frontier: "黄走廊东段",
      disputed_records: [],
      outposts: [{ id: "service-door-a", name: "A号维修门", status: "可返回" }],
    },
    memberKey: "wanderer",
    member: { condition: "stable", exposure: 0, supplies: { light: 6, water: 3, chalk: 5 }, equipment: ["记录器"], private_notes: [], verified_rules: [], route_memory: [], rescue_commitments: [] },
    initialThreads: [
      { id: "labeled-help-message", scope: "exploration", state: "open", beat: "elevator-wrong-floor" },
      { id: "service-door-return", scope: "shared-experiment", state: "unverified", beat: "conflicting-arrows" },
    ],
    rules: [
      "Host 区分已观察事实、玩家记录、规则假说与已验证规律；地图和异常规则只能由可复核行动推进，不能一句话发现出口。",
      "危险升级必须有可感知预兆与撤退窗口；失败造成迷路、暴露、补给损失或救援线程，不用无提示永久淘汰。",
    ],
    actions: [
      ["explore", "确认来路", "action", "backrooms.explore_zone", "我先回头确认自己从哪里掉进来的，并留下一个不会轻易消失的记号。"],
      ["verify", "观察第三次铃响", "action", "backrooms.verify_rule", "我不立刻接电话，退到能撤回的位置，观察第三次铃响前后少了或多了什么。"],
      ["trace", "核对前人刻字", "speech", "backrooms.respond_trace", "我比较墙上两行刻字的新旧、笔迹和内容，把能确认的部分写进公共记录。"],
    ],
    directives: [
      "首轮从熟悉事物突然失常开始，只呈现出口、求救留言和一个感官异常；不要先讲锚点、暴露、规则验证或补给预算。",
      "每次探索用日常语言给出当前位置、方向、可感知细节和退路；补给与危险只在变化时提醒，禁止无限制连续深入。",
      "异常规律在幕后保持一致；未验证记录可能错误但必须可通过交叉观察、对照实验或路线复走确认。",
      "优先让后来者遇到前人真实留下的标记与后果；环境遗留物、NPC、异常存在与真人来源必须清楚区分。",
      "使用原创区域、物资和异常，不直接采用外部后室 wiki 的层级编号、杏仁水或现成实体名称。",
    ],
    hostName: "回廊异常导演",
    hostRole: "narrator",
    tags: ["阈限空间", "异常探索", "公共档案", "异步救援", "原创世界"],
    content: {
      director_abilities: [
        { id: "zone_composer", trigger: "bounded_exploration", effect: "依据原创区域语法和已知地图生成有限、可回退的探索片段" },
        { id: "rule_experiment", trigger: "verification_action", effect: "锁定实验条件、对照、观察结果和规则置信度" },
        { id: "trace_echo", trigger: "verified_public_member_marker_or_recording", effect: "只有公开事件已经确认来源时，才让后来者遇到真人成员留下的记录与后果" },
        { id: "rescue_weaver", trigger: "lost_or_missing", effect: "把失败转为带坐标、线索和窗口的异步救援线程" },
      ],
      thread_templates: [
        { id: "exploration-route", scope: "world", states: ["blank", "observed", "recorded", "cross_checked", "changed"] },
        { id: "rule-experiment", scope: "world", states: ["claim", "observed", "cross_checked", "verified", "disproved"] },
        { id: "rescue", scope: "member_and_world", states: ["missing", "signal_found", "route_open", "contact", "resolved"] },
      ],
      beat_library: [
        { id: "elevator-wrong-floor", trigger: "entry_or_labeled_help_message", scene: "电梯门打开，外面是潮湿发黄的走廊。墙上刻着：“别信第三次铃声。——L”远处一部红色电话已经响了两次，而你身后的楼层数字正在熄灭", choices: ["按住电梯门", "检查两处刻字", "退到安全距离观察电话"], outcome: ["route", "recording", "risk", "public_trace"], hook: "刻字下面还有一句不同笔迹的旧记录：‘我没有接，但这层少了一扇门’，来源需要核对" },
        { id: "conflicting-arrows", trigger: "follow_old_marker", scene: "转角出现两支方向相反的粉笔箭头：较旧的一支写着“出口”，较新的一支写着“他会模仿你的字”", choices: ["比较两种粉笔", "隔着转角呼喊", "留下第三种标记并退回"], outcome: ["marker_reliability", "route", "social_trace"], hook: "较新的箭头旁掉着一张写有当前日期的车票" },
      ],
      npc_cast: [
        { id: "station-recording", name: "17号旧广播", role: "明确标识的环境录音", goal: "重复一段不完整维修通知", tension: "不是活人，也不会回答" },
        { id: "maintenance-echo", name: "维修回声", role: "原创异常现象", goal: "重复固定维修流程", tension: "可预测但不具有人类意图" },
      ],
      event_generator: { inputs: ["current_anchor", "documented_zones", "frontier", "rule_claims", "exposure", "disputed_records", "public_traces"], pools: ["spatial_shift", "sound_pattern", "record_change", "false_familiarity", "resource_cache", "signal", "presence_warning"], rules: ["新区域连接已知地点", "异常规则首次生成后锁定", "每段探索有撤退窗", "只续接已由公开事件确认的真人痕迹", "不采用外部现成后室 canon"] },
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
  const beatIds = new Set(config.content.beat_library.map((beat) => beat.id));
  const missingBeatReferences = config.initialThreads.filter(
    (thread) => thread.beat && !beatIds.has(thread.beat),
  );
  if (missingBeatReferences.length > 0) {
    throw new Error(
      `${config.name} has missing Beat references: ${missingBeatReferences.map((thread) => `${thread.id}->${thread.beat}`).join(", ")}`,
    );
  }
  if (beatIds.size !== config.content.beat_library.length) {
    throw new Error(`${config.name} has duplicate Beat IDs.`);
  }
  const id = `official-${config.slug}`;
  const choices = config.actions.map((action) => choice(config.slug, action));
  const worldStateKeys = ["world_progress", config.stateKey];
  const memberStateKeys = ["journey", config.memberKey];
  const openingBeat =
    config.content.beat_library.find(
      (beat) => beat.id === config.initialThreads[0]?.beat,
    ) ?? config.content.beat_library[0];
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
    entryPrompt: `${openingBeat.scene}。眼前目标：${config.objective}`,
    hostPrompt: [
      `核心目标：${config.objective}`,
      `导演循环：${DIRECTOR_LOOP.join(" -> ")}`,
      `专属要求：${config.directives.join("；")}`,
      `玩家体验要求：${PLAYER_EXPERIENCE_POLICY.principle}${PLAYER_EXPERIENCE_POLICY.language.join("；")}；${PLAYER_EXPERIENCE_POLICY.choice_style}`,
      `异步连续性：${ASYNC_CONTINUITY_POLICY.priority}${ASYNC_CONTINUITY_POLICY.requirements.join("；")}`,
      `多人边界：${COLLECTIVE_DECISION_POLICY.independent}${COLLECTIVE_DECISION_POLICY.npc_role}${COLLECTIVE_DECISION_POLICY.collective}`,
      "必须从结构化线程、Beat、NPC、事件生成器、节奏和恢复模型中选择或组合内容；不得只做宽泛续写。",
      "内部裁决保持完整，但面向玩家按“发生了什么→行动反馈→具体变化→二至三个下一步”表达，不输出内部字段名。",
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
      speakingStyle: "自然、清楚、有画面感，像优秀游戏主持而非规则说明书；先讲发生了什么和为什么值得在意，再给行动反馈与下一步。",
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
          player_experience_policy: PLAYER_EXPERIENCE_POLICY,
          async_continuity_policy: ASYNC_CONTINUITY_POLICY,
          collective_decision_policy: COLLECTIVE_DECISION_POLICY,
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
        welcome_text: config.description,
        setup_prompt: config.objective,
        solo_message: "当前没有其他真人在线也可以完成完整玩法循环；Host 会扮演必要 NPC，但不会伪造真人玩家。",
        solo_objective_text: config.objective,
        solo_choices: choices,
        starter_choices: choices,
        free_input_prompt: "你也可以不选这些，直接说你想做什么。",
      },
      facilitationPolicy: {
        objective_text: config.objective,
        next_actions: choices,
        free_input_prompt: "你也可以不选这些，直接说你想做什么。",
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

export const OFFICIAL_WORLDS = [
  ...WORLDS.map(buildOfficialWorld),
  ...OFFICIAL_ENGLISH_WORLDS,
];

export const OFFICIAL_WORLD_BY_ID = new Map(OFFICIAL_WORLDS.map((world, index) => [world.id, { ...world, index }]));

export const OFFICIAL_WORLD_BY_SLUG = new Map(OFFICIAL_WORLDS.map((world) => [world.slug, world]));
