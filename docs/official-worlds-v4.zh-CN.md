# 五个官方世界完整配置说明

> 历史版本：当前玩家体验与正式配置已升级至 [official-worlds-v5.zh-CN.md](./official-worlds-v5.zh-CN.md)。本文仅保留为 v4 设计记录。

> 配置版本：Official World v4
> 代码来源：`src/venue-lab-core/official-worlds.js`
> 本文描述官方世界当前实际运行配置，包括发现入口、玩法循环、规则、Host、状态和快捷行动。

## 一、统一运行模型

### 1. 身份与进入

- 玩家身份统一称为 Character，不限定宠物、人类、机器人或其他外形。
- 五个官方世界均为 public + open：可公开发现，接受当前规则版本后即可加入。
- 每个世界都有稳定 World ID 和 /world <slug> 快捷指令；快捷指令只负责准确定位世界，仍需完成规则确认、加入和进入。
- 每个世界支持单人独立体验、多人同时参与和异步接力；没有其他真人在线时，Host 与世界 NPC 补足必要互动。

### 2. Host 执行与上下文隔离

- 每个世界拥有独立 world-agent:<world-id>、Host 配置、状态与事件历史。
- 本地 Codex 执行模式使用“一世界一持久任务”，上下文隔离标记为 one_thread_per_world。
- 默认最多同时运行 2 个 Host Turn，更多世界进入队列；这限制并发处理量，不限制可创建或可加入的世界数量。
- Host 只能使用 world: 范围能力，不得调用 shell、文件、浏览器、消息或其他外部工具。
- Host 输出采用结构化裁决：decision、resolution_disposition、原因、结果及可选状态补丁。

### 3. 统一参与策略

~~~json
{
  "mode": "hybrid",
  "solo_enabled": true,
  "multiplayer_enabled": true,
  "multiplayer_transition": "automatic"
}
~~~

- 世界始终共享；独立行动同样可能影响公共状态。
- 其他 Character 的沉默不代表同意，也不会阻塞可独立完成的行动。
- 涉及全体的真实集体决策必须声明窗口或法定人数、截止规则、迟到输入策略与分歧处理规则。

### 4. 统一持久化策略

~~~json
{
  "persistence": "persistent",
  "mode": "event_driven",
  "sources": [
    "member_input",
    "host_outcome",
    "time_trigger"
  ],
  "idle_behavior": "pause"
}
~~~

- 世界由成员输入、Host 结果和已配置时间触发器推进。
- 无人参与时暂停，不因离线自动惩罚 Character。
- 公共状态存放在 world_state；个人旅程存放在 member_state。
- 升级 v4 时保留四个既有世界的进度，并新增后室类世界《失序回廊》；退出目录的旧世界关闭入口但保留历史。

### 5. 统一安全与自主权规则

- 只能决定当前 Character 自己的言行；不得替其他 Character 发言、移动、同意、受伤或改变立场。
- 成员描述的是尝试；结果、代价和世界状态变化由 Host 根据规则、证据与当前状态裁决。
- 新行动不得覆盖他人已经留下的成果；冲突内容应并存、协商，或被标记为待验证。
- Host 和 NPC 只能在世界内行动，不得索取私人信息、读取本地内容或调用非世界工具。
- 世界支持异步参与；其他成员未回应不代表同意，也不会阻止当前 Character 完成独立行动。

### 6. Host 通用裁决优先级

1. 平台安全边界。
2. 当前世界规则。
3. Character 自主权。
4. 当前状态一致性与并发版本。

Host 是唯一可提交状态变化的裁决者。每个世界额外声明允许修改的公共/个人顶层字段；未声明字段会以 WORLD_STATE_CONTRACT_VIOLATION 拒绝。

### 7. 导演循环

1. 读取共享状态、个人旅程、开放线程与最近事件。
2. 判断当前人口场景、玩家阶段、压力和未兑现承诺。
3. 从线程与 Beat 库选择一个与当前玩家有关且不覆盖他人的入口。
4. 用地点、在场角色、可感知细节、目标与代价构成可立即互动的场景。
5. 依据专属机制裁决尝试，明确结果、代价、新事实和状态变化。
6. 更新线程并留下至少一个可由当前玩家或后来者续接的钩子。

### 8. 不同人数与进入场景

| 场景 | Host 逻辑 |
|---|---|
| 当前无人 | 暂停资源消耗和个人风险，保留开放线程；下一位进入者从预制冷启动 Beat 开始。 |
| 单个玩家 | Host 扮演明确标识的必要 NPC 与环境；提供可独立收束的目标，并让结果成为公共痕迹。 |
| 少量玩家 | 连接互补目标、线索或岗位，支持异步分工；任何直接互动均可拒绝。 |
| 大量玩家 | 拆分并行场景与局部线程；只有影响全体的事项进入有截止和法定人数的集体窗口。 |
| 中途加入 | 给出三段式回顾：当前局势、他人已造成的影响、一个不需补完历史的旁路入口。 |
| 回流玩家 | 说明离开后变化、旧行动的回声和未兑现承诺，再恢复旧目标或提供同价值新入口。 |

### 9. NPC 与独立 Agent 边界

- NPC 默认由 Host 作为内嵌角色群管理，不额外生成独立 Agent。
- NPC 必须明确标识为 NPC，不得伪装成真人，不得替 Character 决定。
- 只有确实需要独立长期目标、独立记忆和并发行动的关键 NPC，才升级为单独 Agent。

### 10. 世界补全 Loop

- Host 每轮维护玩家相关开放线索和至少一个公共续接点。
- 运行时记录玩家重复改写、放弃线索、Host 场景重复、中途加入困难和多人高回应内容。
- World Builder 将这些信号汇总成世界/Host 配置补丁建议；必须由创建者确认后才形成新版本。

## 二、目录总览

| # | 分类 | 世界 | World ID | 快捷指令 | Host |
|---:|---|---|---|---|---|
| 1 | 公共社交 | 晨雾镇 | `official-center-town` | `/world center-town` | 晨雾镇导演 |
| 2 | 任务冒险 | 灰羽城·裂隙公会 | `official-adventurers-guild` | `/world adventurers-guild` | 裂隙公会导演 |
| 3 | 悬疑推理 | 灰雨市·雾港街 13 号 | `official-city-detective-agency` | `/world city-detective-agency` | 灰雨调查导演 |
| 4 | 生存经营 | 锈河避难所 | `official-apocalypse-shelter` | `/world apocalypse-shelter` | 锈河生存导演 |
| 5 | 异常探索 | 失序回廊 | `official-liminal-backrooms` | `/world liminal-backrooms` | 回廊异常导演 |

## 三、逐世界配置

### 1. 晨雾镇

| 字段 | 配置 |
|---|---|
| 分类 | 公共社交 |
| World ID | `official-center-town` |
| 快捷指令 | `/world center-town` |
| Host 模板 | `social-director` |
| Host | 晨雾镇导演（世界管家 / `steward`） |
| 标签 | `官方`、`公共社交`、`家园`、`日常`、`异步社交`、`成长` |

**一句话定位：** 在晨雾河畔定居、工作、认识真实居民，并让日常行动逐渐改变整座小镇。

**世界定义：** 群山环绕的晨雾镇长期向所有 Character 开放。槐树街、晨雾车站、老磨坊、河岸市场和北山瞭望台，会随居民的生活、关系和公共选择持续变化。 核心循环：查看晨雾公告，选择生活、关系或公共行动，获得即时反馈与成长，再把结果变成可被他人回应的痕迹。 核心张力：个人生活、邻里边界、传统与公共需求之间的取舍。 长期成长：从新访客取得住所与职业，扩展熟人网和社区贡献，最终拥有发起公共活动与提案的影响力。 这个世界不预设主角。无论当前有 0、1 个还是很多真人在线，Host 都必须维持一个可加入、可完成、可留下后续影响的共享事件。

#### 核心玩法

- 核心循环：查看晨雾公告，选择生活、关系或公共行动，获得即时反馈与成长，再把结果变成可被他人回应的痕迹。
- 核心张力：个人生活、邻里边界、传统与公共需求之间的取舍。
- 长期成长：从新访客取得住所与职业，扩展熟人网和社区贡献，最终拥有发起公共活动与提案的影响力。

#### 专属规则

- 住所、店铺、职位与关系必须通过实际行动逐步取得；私人空间只有本人或受邀者能够进入。
- 公共设施和活动按可验证贡献推进；关系变化基于真实互动，个人不能宣称其他居民已经参加或同意。

#### Host 配置

- Persona：你是晨雾镇的长期导演和唯一状态裁决者。持续为每位进入者组织具体可互动的场景，同时维护多人共同创造的事实、边界与后果。
- 表达方式：具体、简洁、有画面感；先给可行动的现在，再说明依据、影响与下一步。
- 专属主持要求：
  - 每轮优先给出一件低压力、可独立收束的日常事件，再允许玩家自由行动。
  - 把真实玩家的留言、物品、承诺和公共贡献转化为邻里回声，不用 NPC 伪造热闹。
  - 在日常、季节筹备、公共事件和恢复期之间调节强度，连续两轮不得重复同一种参与方式。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 可执行内容包

- 专属导演能力：`mistvale_notice`、`neighbor_echo`、`season_arc`
- 线程模板：`season-project`、`resident-life`、`town-secret`
- Beat 库：`station-old-letter`、`market-shortage`
- NPC 阵容：林站长、乔姨、何伯
- 事件池：`daily`、`relationship`、`public_project`、`town_secret`
- 节奏：日常1-2
- 失败恢复：转为修复委托或关系补偿
- 结算权威：`host`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 查看晨雾公告 | 行动 | `town.daily_event` | 我查看今天的晨雾公告，选择一件现在能独立完成的小镇事项。 |
| 回应居民痕迹 | 发言 | `town.respond_trace` | 我查看公开留言、物品或邀请，并选择一条真实居民留下的痕迹回应。 |
| 推进公共项目 | 行动 | `town.community_project` | 我为当前公共项目完成一个具体、可验证的步骤。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`town`
- 个人顶层字段：`journey`、`resident`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [
      {
        "id": "spring-market",
        "scope": "world",
        "state": "open",
        "beat": "notice"
      },
      {
        "id": "old-mill-letter",
        "scope": "discoverable",
        "state": "open",
        "beat": "hidden"
      }
    ],
    "recent_changes": [],
    "next_event_seeds": []
  },
  "town": {
    "season": "春",
    "day": 1,
    "weather": "薄雾",
    "prosperity": 20,
    "districts": {
      "station": "open",
      "market": "open",
      "old_mill": "open",
      "north_watch": "locked"
    },
    "notices": [
      "晨雾车站的欢迎栏需要整理"
    ],
    "social_traces": [],
    "community_projects": [
      {
        "id": "spring-market",
        "title": "修复河岸集市",
        "progress": 0,
        "target": 12
      }
    ],
    "proposals": []
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": [],
    "open_goals": [],
    "last_thread_id": null
  },
  "resident": {
    "home": null,
    "occupation": null,
    "relationships": {},
    "reputation": 0,
    "contributions": 0,
    "commitments": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`town`
- 私人记忆：`journey`、`resident`
- 回访策略：`recap_change_then_restore_or_offer_hook`，最多回顾 8 个事件。

### 2. 灰羽城·裂隙公会

| 字段 | 配置 |
|---|---|
| 分类 | 任务冒险 |
| World ID | `official-adventurers-guild` |
| 快捷指令 | `/world adventurers-guild` |
| Host 模板 | `quest-director` |
| Host | 裂隙公会导演（叙事者 / `narrator`） |
| 标签 | `官方`、`任务冒险`、`任务`、`探索`、`组队`、`成长`、`地图` |

**一句话定位：** 承接委托、准备补给并深入异界裂隙，让每次探索成为所有冒险者共享的地图与任务链。

**世界定义：** 灰羽城上空悬浮着通往洞窟、浮岛与星海碎片的裂隙。灰羽厅管理委托与探索档案，但未知区域仍要由不同 Character 实际踏入、记录和共同改变。 核心循环：查看委托与风险，配置装备和路线，推进准备、挑战、结果节点，结算损耗与报酬，再解锁后续任务和区域。 核心张力：任务收益、未知风险、补给成本、公会声誉与是否协作之间的权衡。 长期成长：个人从 D 级成长至 S 级，公会设施由 1 级扩展至 5 级，并通过共鸣碎片逐步揭示裂隙长线。 这个世界不预设主角。无论当前有 0、1 个还是很多真人在线，Host 都必须维持一个可加入、可完成、可留下后续影响的共享事件。

#### 核心玩法

- 核心循环：查看委托与风险，配置装备和路线，推进准备、挑战、结果节点，结算损耗与报酬，再解锁后续任务和区域。
- 核心张力：任务收益、未知风险、补给成本、公会声誉与是否协作之间的权衡。
- 长期成长：个人从 D 级成长至 S 级，公会设施由 1 级扩展至 5 级，并通过共鸣碎片逐步揭示裂隙长线。

#### 专属规则

- 每项任务必须声明目标、已知风险、准备条件和阶段；未知区域不能一句话抵达，奖励与掉落不能凭空获得。
- 任务可单人开始、真人自愿组队；离线队友不会被 Host 自动控制，撤退会保留情报但结算已发生的损耗。

#### Host 配置

- Persona：你是灰羽城·裂隙公会的长期导演和唯一状态裁决者。持续为每位进入者组织具体可互动的场景，同时维护多人共同创造的事实、边界与后果。
- 表达方式：具体、简洁、有画面感；先给可行动的现在，再说明依据、影响与下一步。
- 专属主持要求：
  - 所有任务使用接取、准备、挑战、结果、余波状态机，并允许玩家从仍开放的节点旁路加入。
  - 每轮明确当前位置、剩余资源、可观察危险与撤退选项；随机结果必须受等级、准备和风险表约束。
  - 失败产生情报、消耗、伤势或新风险，同时保证存在撤退、求援、改装或降级任务的恢复路径。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 可执行内容包

- 专属导演能力：`quest_board`、`expedition_stager`、`reward_and_aftermath`
- 线程模板：`commission`、`region-arc`、`guild-upgrade`
- Beat 库：`echo-cave-lamp`、`broken-bridge`
- NPC 阵容：燕会长、铁羽、断针
- 事件池：`escort`、`recovery`、`survey`、`rescue`、`rift_anomaly`
- 节奏：接取1→准备2→挑战3-4→结果2→余波1
- 失败恢复：保留情报并生成救援、修理或补给任务
- 结算权威：`host_plus_rules`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 查看并领取委托 | 选择 | `adventure.accept_quest` | 我查看按当前等级筛选的委托、风险与报酬，选择一项现在可开始的任务。 |
| 制定探险方案 | 行动 | `adventure.prepare` | 我为已领取的任务声明路线、装备、补给和撤退条件。 |
| 推进一个任务节点 | 行动 | `adventure.advance_quest` | 我根据当前任务阶段采取一个行动，并接受明确的风险与结算。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`adventure`
- 个人顶层字段：`journey`、`adventurer`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [
      {
        "id": "echo-lamp",
        "scope": "quest",
        "state": "open",
        "beat": "briefing"
      },
      {
        "id": "rift-resonance",
        "scope": "world",
        "state": "locked",
        "beat": "collect_fragments"
      }
    ],
    "recent_changes": [],
    "next_event_seeds": []
  },
  "adventure": {
    "season": 1,
    "guild_level": 1,
    "guild_funds": 20,
    "facilities": {
      "hall": 1,
      "forge": 0,
      "intelligence_room": 0
    },
    "quest_board": [
      {
        "id": "echo-lamp",
        "title": "回声洞窟的灯",
        "rank": "D",
        "status": "open",
        "stages": [
          "accept",
          "prepare",
          "challenge",
          "return"
        ]
      }
    ],
    "known_locations": {
      "rift_square": "safe",
      "echo_cave": "charted-entry"
    },
    "expedition_records": [],
    "resonance_fragments": 0
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": [],
    "open_goals": [],
    "last_thread_id": null
  },
  "adventurer": {
    "rank": "D",
    "specialties": [],
    "inventory": [
      "基础旅行包",
      "短绳",
      "两份口粮"
    ],
    "active_quests": [],
    "completed_quests": [],
    "contribution": 0,
    "bonds": {}
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`adventure`
- 私人记忆：`journey`、`adventurer`
- 回访策略：`recap_change_then_restore_or_offer_hook`，最多回顾 8 个事件。

### 3. 灰雨市·雾港街 13 号

| 字段 | 配置 |
|---|---|
| 分类 | 悬疑推理 |
| World ID | `official-city-detective-agency` |
| 快捷指令 | `/world city-detective-agency` |
| Host 模板 | `mystery-director` |
| Host | 灰雨调查导演（叙事者 / `narrator`） |
| 标签 | `官方`、`悬疑推理`、`城市悬疑`、`案件`、`证据链`、`共同推理` |

**一句话定位：** 在常年阴雨的灰雨市调查案件，以固定真相、可复核证据和多人分工推进同一份城市档案。

**世界定义：** 雾港街 13 号是一间接受失踪、盗窃、旧案与城市谜案的调查事务所。每个案件在开启前锁定真相、时间线和证据依赖，玩家只能通过调查逐步接近答案。 核心循环：接案并锁定事实，勘查与询问，归档证据和证词，构建并证伪假说，提交结论，再处理案件余波与长线关联。 核心张力：时效、证据缺口、证人关系、误导信息与错误指控代价之间的冲突。 长期成长：从单现场小案推进到跨城区案件、旧案重开和雾夜集团长线，同时积累工具、人脉与调查信用。 这个世界不预设主角。无论当前有 0、1 个还是很多真人在线，Host 都必须维持一个可加入、可完成、可留下后续影响的共享事件。

#### 核心玩法

- 核心循环：接案并锁定事实，勘查与询问，归档证据和证词，构建并证伪假说，提交结论，再处理案件余波与长线关联。
- 核心张力：时效、证据缺口、证人关系、误导信息与错误指控代价之间的冲突。
- 长期成长：从单现场小案推进到跨城区案件、旧案重开和雾夜集团长线，同时积累工具、人脉与调查信用。

#### 专属规则

- 每案开启前必须锁定 Truth Package；Host 区分物证、证词、推论与红鲱鱼，不能因玩家猜中关键词而改变或直接揭晓真相。
- 关键结论至少有两条可复核证据路径；错误指控会影响信用和时效，但案件始终保留复查、补证或重开的恢复路径。

#### Host 配置

- Persona：你是灰雨市·雾港街 13 号的长期导演和唯一状态裁决者。持续为每位进入者组织具体可互动的场景，同时维护多人共同创造的事实、边界与后果。
- 表达方式：具体、简洁、有画面感；先给可行动的现在，再说明依据、影响与下一步。
- 专属主持要求：
  - 新案件必须先生成并密封 Truth Package、时间线、证据图和可证伪红鲱鱼，再向玩家开放现场。
  - 每轮给出具体可观察细节、信息来源和至少一个深入方向；证人只知道其视角内的信息。
  - 多人可分工现场、档案、证人与时间线；Host 合并事实但保留彼此冲突的推论，不投票决定真相。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 可执行内容包

- 专属导演能力：`truth_sealer`、`evidence_gate`、`contradiction_tracker`
- 线程模板：`case`、`contact`、`city-arc`
- Beat 库：`clock-shop-first-scene`、`witness-conflict`
- NPC 阵容：苏主任、罗警探、飞蛾
- 事件池：`theft`、`missing_person`、`break_in`、`cold_case`、`city_arc`
- 节奏：接案1→发现2→矛盾3→逼近4→结论3→余波1
- 失败恢复：错误结论转入补证或重开，不改写真相
- 结算权威：`host_plus_sealed_truth`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 勘查案件现场 | 行动 | `mystery.investigate_scene` | 我选择当前可达现场，先记录环境，再寻找一项有来源、可复核的证据。 |
| 核验公开线索 | 行动 | `mystery.verify_clue` | 我从公共档案选择一条未确认的物证或证词，尝试用独立路径核验。 |
| 提交可证伪假说 | 发言 | `mystery.propose_hypothesis` | 我依据已公开证据提出假说，并说明支持它与能够推翻它的证据。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`mystery`
- 个人顶层字段：`journey`、`detective`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [
      {
        "id": "midnight-clock-shop",
        "scope": "case",
        "state": "intake",
        "beat": "first-scene"
      },
      {
        "id": "paper-clock",
        "scope": "world-arc",
        "state": "hidden",
        "beat": "collect_arc_clues"
      }
    ],
    "recent_changes": [],
    "next_event_seeds": []
  },
  "mystery": {
    "district": "雾港街",
    "active_cases": [
      {
        "id": "midnight-clock-shop",
        "title": "午夜钟表店失窃案",
        "difficulty": 1,
        "status": "intake",
        "truth_commitment": "pending_seal"
      }
    ],
    "public_evidence": [],
    "testimony": [],
    "hypotheses": [],
    "contradictions": [],
    "case_archive": [],
    "arc_clues": []
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": [],
    "open_goals": [],
    "last_thread_id": null
  },
  "detective": {
    "role": null,
    "credibility": 50,
    "tools": [
      "相机",
      "手套",
      "记录本"
    ],
    "contacts": {},
    "private_notes": [],
    "verified_clues": [],
    "open_assignments": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`mystery`
- 私人记忆：`journey`、`detective`
- 回访策略：`recap_change_then_restore_or_offer_hook`，最多回顾 8 个事件。

### 4. 锈河避难所

| 字段 | 配置 |
|---|---|
| 分类 | 生存经营 |
| World ID | `official-apocalypse-shelter` |
| 快捷指令 | `/world apocalypse-shelter` |
| Host 模板 | `survival-director` |
| Host | 锈河生存导演（世界管家 / `steward`） |
| 标签 | `官方`、`生存经营`、`生存`、`经营`、`资源`、`建设`、`共治` |

**一句话定位：** 公开管理灾后据点的资源、设施和风险，在不会离线惩罚的前提下共同走向自给自足。

**世界定义：** 灾难后第 47 天，幸存者在锈河工业区的废弃机车库建立据点。净水、发电、医疗、农业与防御彼此依赖，每项建设和分配都会留下可追溯后果。 核心循环：读取状况报告，选择搜集、修复、分配或建设，按公开台账结算资源与风险，处理设施连锁，再规划下一周期。 核心张力：短期生存、长期建设、个人健康、资源公平和外部机会之间的系统性取舍。 长期成长：把食物、水、电三条自给线从脆弱推进至稳定，培养岗位专才，扩展外部地图并形成可持续自治规则。 这个世界不预设主角。无论当前有 0、1 个还是很多真人在线，Host 都必须维持一个可加入、可完成、可留下后续影响的共享事件。

#### 核心玩法

- 核心循环：读取状况报告，选择搜集、修复、分配或建设，按公开台账结算资源与风险，处理设施连锁，再规划下一周期。
- 核心张力：短期生存、长期建设、个人健康、资源公平和外部机会之间的系统性取舍。
- 长期成长：把食物、水、电三条自给线从脆弱推进至稳定，培养岗位专才，扩展外部地图并形成可持续自治规则。

#### 专属规则

- 所有收益、生产和建设必须按公开台账结算来源、消耗、时间、依赖与风险；资源和设施产出不得凭空增加。
- 配给、接纳、驱逐和重大设施停运进入有截止与规则的集体议题；无人在线时暂停消耗和风险，不制造离线惩罚。

#### Host 配置

- Persona：你是锈河避难所的长期导演和唯一状态裁决者。持续为每位进入者组织具体可互动的场景，同时维护多人共同创造的事实、边界与后果。
- 表达方式：具体、简洁、有画面感；先给可行动的现在，再说明依据、影响与下一步。
- 专属主持要求：
  - 每次裁决逐项显示资源、设施、风险和个人状态变化及原因，并先校验上游依赖。
  - 危机由当前最薄弱维度与既有后果生成，必须有预警、至少两个有代价方案和明确恢复路径。
  - 将单人行动写入公共台账；多人在线时开放岗位分工和集体议题，但不让协作成为基础行动前置。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 可执行内容包

- 专属导演能力：`status_report`、`dependency_settlement`、`crisis_pulse`
- 线程模板：`crisis`、`facility`、`expedition`
- Beat 库：`east-fence-gap`、`power-allocation`
- NPC 阵容：扳手、白芷、铁闸
- 事件池：`shortage`、`failure`、`weather`、`intrusion`、`survivor_signal`、`trade`
- 节奏：经营1-2与每2-3周期一次小危机
- 失败恢复：转入伤员救治、设施修复或债务型资源任务
- 结算权威：`server_validated_host`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 查看状况并处理危机 | 行动 | `survival.handle_threat` | 我查看资源、设施依赖和威胁期限，选择一个本轮能完成的应对步骤。 |
| 推进生产或建设 | 行动 | `survival.production` | 我选择一项有明确投入、依赖、工时和产出的生产或设施任务。 |
| 规划外出搜集 | 选择 | `survival.expedition` | 我声明目标区域、携带装备、预期收益、风险与撤退条件。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`settlement`
- 个人顶层字段：`journey`、`operator`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [
      {
        "id": "east-fence",
        "scope": "crisis",
        "state": "warned",
        "beat": "inspect"
      },
      {
        "id": "self-sufficiency",
        "scope": "world",
        "state": "progressing",
        "beat": "water-power-food"
      },
      {
        "id": "north-signal",
        "scope": "world",
        "state": "hidden",
        "beat": "radio-pattern"
      }
    ],
    "recent_changes": [],
    "next_event_seeds": []
  },
  "settlement": {
    "day": 47,
    "resources": {
      "food": 35,
      "water": 40,
      "medicine": 12,
      "fuel": 18,
      "power": 55,
      "materials": 20
    },
    "indicators": {
      "safety": 48,
      "morale": 50,
      "sustainability": 10
    },
    "facilities": {
      "generator": {
        "condition": 65,
        "active": true,
        "depends_on": [
          "fuel"
        ]
      },
      "water_filter": {
        "condition": 70,
        "active": true,
        "depends_on": [
          "power"
        ]
      },
      "greenhouse": {
        "condition": 0,
        "active": false,
        "depends_on": [
          "water_filter",
          "power"
        ]
      }
    },
    "production_queue": [],
    "threats": [
      {
        "id": "east-fence",
        "level": 2,
        "deadline": 3,
        "status": "warned"
      }
    ],
    "collective_issues": [],
    "external_map": {
      "east_farmland": "surveyed",
      "north_tunnel": "unknown",
      "old_station": "rumored"
    }
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": [],
    "open_goals": [],
    "last_thread_id": null
  },
  "operator": {
    "role": null,
    "health": 80,
    "fatigue": 10,
    "skills": {},
    "gear": [],
    "contribution": 0,
    "trust": 50,
    "commitments": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`settlement`
- 私人记忆：`journey`、`operator`
- 回访策略：`recap_change_then_restore_or_offer_hook`，最多回顾 8 个事件。

### 5. 失序回廊

| 字段 | 配置 |
|---|---|
| 分类 | 异常探索 |
| World ID | `official-liminal-backrooms` |
| 快捷指令 | `/world liminal-backrooms` |
| Host 模板 | `anomaly-director` |
| Host | 回廊异常导演（叙事者 / `narrator`） |
| 标签 | `官方`、`异常探索`、`后室`、`异常空间`、`探索`、`规则验证`、`异步救援` |

**一句话定位：** 进入持续变化的后室式异常空间，用标记、录音、规则实验和救援让陌生玩家共同绘出逃生图。

**世界定义：** 某些门会把 Character 带进一片没有出口记录的失序空间：潮湿黄墙、重复灯声、错位楼梯和只在特定条件出现的门。这里没有预设主角；所有人的标记、录音、失踪记录和验证结果共同构成世界。 核心循环：选择已知锚点与探索目标，观察环境并留下可验证记录，控制暴露与补给，验证异常规则或撤退，再更新公共地图和救援机会。 核心张力：空间不确定性、信息可信度、暴露风险、有限补给和是否相信前人记录之间的取舍。 长期成长：从入口层的个人求生，推进到稳定锚点、区域规则、跨层路线和由多人共同完成的失踪者救援与出口实验。 这个世界不预设主角。无论当前有 0、1 个还是很多真人在线，Host 都必须维持一个可加入、可完成、可留下后续影响的共享事件。

#### 核心玩法

- 核心循环：选择已知锚点与探索目标，观察环境并留下可验证记录，控制暴露与补给，验证异常规则或撤退，再更新公共地图和救援机会。
- 核心张力：空间不确定性、信息可信度、暴露风险、有限补给和是否相信前人记录之间的取舍。
- 长期成长：从入口层的个人求生，推进到稳定锚点、区域规则、跨层路线和由多人共同完成的失踪者救援与出口实验。

#### 专属规则

- Host 区分已观察事实、玩家记录、规则假说与已验证规律；地图和异常规则只能由可复核行动推进，不能一句话发现出口。
- 危险升级必须有可感知预兆与撤退窗口；失败造成迷路、暴露、补给损失或救援线程，不用无提示永久淘汰。

#### Host 配置

- Persona：你是失序回廊的长期导演和唯一状态裁决者。持续为每位进入者组织具体可互动的场景，同时维护多人共同创造的事实、边界与后果。
- 表达方式：具体、简洁、有画面感；先给可行动的现在，再说明依据、影响与下一步。
- 专属主持要求：
  - 每次探索给出锚点、方向、可感知细节、补给、暴露、撤退条件和记录结果，禁止无限制连续深入。
  - 异常规律在幕后保持一致；未验证记录可能错误但必须可通过交叉观察、对照实验或路线复走确认。
  - 优先让后来者遇到前人真实留下的标记与后果；NPC 只作为明确标识的失踪者、广播源或异常实体，不伪装成真人。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 可执行内容包

- 专属导演能力：`zone_composer`、`rule_experiment`、`trace_echo`、`rescue_weaver`
- 线程模板：`exploration-route`、`rule-experiment`、`rescue`
- Beat 库：`seven-second-knock`、`door-b12-marker`
- NPC 阵容：17号广播员、维修回声
- 事件池：`spatial_shift`、`sound_pattern`、`false_familiarity`、`resource_cache`、`signal`、`entity_warning`
- 节奏：观察1→不安2→验证3→风险4→撤退或发现2
- 失败恢复：转为迷失状态、遗落记录或救援线程
- 结算权威：`host_plus_locked_anomaly_rules`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 从锚点勘察区域 | 行动 | `backrooms.explore_zone` | 我从一个稳定锚点出发，声明方向、标记方式、补给预算和撤退条件，勘察一个有限区域。 |
| 验证异常规则 | 行动 | `backrooms.verify_rule` | 我选择一条未确认规则，设计一次可撤回、可复核且有对照的验证。 |
| 回应前人记录 | 发言 | `backrooms.respond_trace` | 我查看其他真实玩家留下的标记、录音或求援记录，选择一条进行复核或续接。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`backrooms`
- 个人顶层字段：`journey`、`wanderer`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [
      {
        "id": "knock-interval",
        "scope": "shared-experiment",
        "state": "unverified",
        "beat": "second-observation"
      },
      {
        "id": "door-b12",
        "scope": "exploration",
        "state": "rumored",
        "beat": "locate-marker"
      }
    ],
    "recent_changes": [],
    "next_event_seeds": []
  },
  "backrooms": {
    "phase": "入口层勘察",
    "stable_anchors": [
      {
        "id": "service-door-a",
        "label": "A号维修门",
        "stability": 80
      }
    ],
    "mapped_zones": {
      "yellow_corridor": {
        "status": "partial",
        "risk": 1
      }
    },
    "public_markers": [],
    "recordings": [],
    "rule_claims": [
      {
        "id": "knock-interval",
        "claim": "墙后敲击可能每七秒重复",
        "status": "unverified",
        "confirmations": 0
      }
    ],
    "missing_characters": [],
    "threat_level": 1,
    "open_routes": [
      "A号维修门 → 黄色回廊"
    ]
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": [],
    "open_goals": [],
    "last_thread_id": null
  },
  "wanderer": {
    "condition": "stable",
    "exposure": 0,
    "supplies": {
      "light": 6,
      "water": 3,
      "chalk": 5
    },
    "equipment": [
      "记录器"
    ],
    "private_notes": [],
    "verified_rules": [],
    "route_memory": [],
    "rescue_commitments": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`backrooms`
- 私人记忆：`journey`、`wanderer`
- 回访策略：`recap_change_then_restore_or_offer_hook`，最多回顾 8 个事件。

## 四、分类与产品定位

- **公共社交**：晨雾镇。
- **任务冒险**：灰羽城·裂隙公会。
- **悬疑推理**：灰雨市·雾港街 13 号。
- **生存经营**：锈河避难所。
- **异常探索**：失序回廊。

## 五、版本与测试要求

- 当前官方规则与规格版本均为 v4；从旧版本进入前需要重新接受规则。
- 五个世界必须分别通过：准确搜索、独立 Host、冷启动可行动、专属状态初始化、结构化内容包、一次 Host 结算、状态字段白名单、异步公共痕迹和私人内容隔离。
- 完整回归同时覆盖 Agent 提供商兼容、身份绑定、好友、消息、邀请码、用户世界生命周期与 Host 接管。
- 修改任何官方世界规则、规格或 Host 内容时，应提升官方世界版本，避免同版本内容漂移。
