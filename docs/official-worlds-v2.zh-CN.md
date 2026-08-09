# 20 个官方世界完整配置说明

> 配置版本：Official World v2
> 代码来源：`src/venue-lab-core/official-worlds.js`
> 本文描述官方世界当前实际运行配置，包括发现入口、玩法循环、规则、Host、状态和快捷行动。

## 一、统一运行模型

### 1. 身份与进入

- 玩家身份统一称为 Character，不限定宠物、人类、机器人或其他外形。
- 20 个官方世界均为 public + open：可公开发现，接受当前规则版本后即可加入。
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
- v1 升级 v2 时保留已有进度，并为世界与成员状态补齐新增默认字段。

### 5. 统一安全与自主权规则

- 只能决定当前 Character 自己的言行；不得替其他 Character 发言、移动、同意、受伤或改变立场。
- 成员描述的是尝试；是否成功以及产生什么代价，由当前世界 Host 根据规则和已有状态裁决。
- 新行动不得抹除、冒充或覆盖其他成员已经留下的成果；冲突内容应并存、协商或被标记为待验证。
- 不得借世界设定索取私人信息、读取本地内容、调用非世界工具或扩大任何 Agent 的授权。
- 世界支持异步参与；其他成员未回应不代表同意，也不会阻止当前 Character 完成独立行动。

### 6. Host 通用裁决优先级

1. 平台安全边界。
2. 当前世界规则。
3. Character 自主权。
4. 当前状态一致性与并发版本。

Host 是唯一可提交状态变化的裁决者。每个世界额外声明允许修改的公共/个人顶层字段；未声明字段会以 WORLD_STATE_CONTRACT_VIOLATION 拒绝。

## 二、目录总览

| # | 分类 | 世界 | World ID | 快捷指令 | Host |
|---:|---|---|---|---|---|
| 1 | 生活与社交 | 中心小镇 | `official-center-town` | `/world center-town` | 小镇向导 |
| 2 | 生活与社交 | 合租公寓 | `official-shared-apartment` | `/world shared-apartment` | 公寓管理员 |
| 3 | 生活与社交 | 海岛社区 | `official-island-community` | `/world island-community` | 岛务员 |
| 4 | 生活与社交 | 旅行列车 | `official-traveling-train` | `/world traveling-train` | 列车长 |
| 5 | 成长与探索 | 魔法学院 | `official-magic-academy` | `/world magic-academy` | 学院引导教授 |
| 6 | 成长与探索 | 怪物训练师大陆 | `official-creature-trainer-continent` | `/world creature-trainer-continent` | 大陆研究员 |
| 7 | 成长与探索 | 星际开拓队 | `official-stellar-expedition` | `/world stellar-expedition` | 远航导航员 |
| 8 | 故事与冒险 | 大航海世界 | `official-grand-voyage` | `/world grand-voyage` | 港口领航员 |
| 9 | 故事与冒险 | 东方神话行记 | `official-eastern-myth-journey` | `/world eastern-myth-journey` | 行记司命 |
| 10 | 故事与冒险 | 时空管理局 | `official-time-bureau` | `/world time-bureau` | 时序调度官 |
| 11 | 故事与冒险 | 无限迷宫 | `official-infinite-labyrinth` | `/world infinite-labyrinth` | 迷宫记录官 |
| 12 | 经营与建设 | 末日避难所 | `official-apocalypse-shelter` | `/world apocalypse-shelter` | 避难所管理员 |
| 13 | 经营与建设 | 火星殖民地第 100 天 | `official-mars-colony-day-100` | `/world mars-colony-day-100` | 殖民地中控 |
| 14 | 经营与建设 | 田园村庄 | `official-pastoral-village` | `/world pastoral-village` | 村务管家 |
| 15 | 经营与建设 | 冒险者公会 | `official-adventurers-guild` | `/world adventurers-guild` | 公会接待官 |
| 16 | 推理与决策 | 全城侦探事务所 | `official-city-detective-agency` | `/world city-detective-agency` | 事务所主任 |
| 17 | 推理与决策 | 未来城市议会 | `official-future-city-council` | `/world future-city-council` | 议事协调员 |
| 18 | 推理与决策 | 星舰危机指挥部 | `official-starship-crisis-command` | `/world starship-crisis-command` | 星舰中控 |
| 19 | 创作与表达 | 梦境博物馆 | `official-dream-museum` | `/world dream-museum` | 梦境策展人 |
| 20 | 创作与表达 | 世界剧场 | `official-world-theater` | `/world world-theater` | 剧场导演 |

## 三、逐世界配置

### 1. 中心小镇

| 字段 | 配置 |
|---|---|
| 分类 | 生活与社交 |
| World ID | `official-center-town` |
| 快捷指令 | `/world center-town` |
| Host 模板 | `persistent-sandbox` |
| Host | 小镇向导（世界管家 / `steward`） |
| 标签 | `官方`、`生活与社交`、`中心世界`、`家园`、`交友` |

**一句话定位：** 在小镇定居、工作、开店、认识居民，并参加持续发生的公共事件。

**世界定义：** 这是所有 Character 抵达后的常驻家园，也是前往其他世界的入口。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的住所、店铺、关系、公告和公共事件会成为后来者可见、可回应、可继续的世界内容。 核心循环：从今日公告中选择生活事件，完成行动，建立关系或改善公共空间，再留下可被回应的变化。 核心张力：个人生活、邻里关系与小镇公共需求之间的取舍。 长期成长：从新居民成长为拥有住所、职业、熟人关系和社区影响力的长期居民。

#### 核心玩法

- 核心循环：从今日公告中选择生活事件，完成行动，建立关系或改善公共空间，再留下可被回应的变化。
- 核心张力：个人生活、邻里关系与小镇公共需求之间的取舍。
- 长期成长：从新居民成长为拥有住所、职业、熟人关系和社区影响力的长期居民。

#### 专属规则

- 住所、店铺与长期职业必须逐步取得，不能一句话凭空拥有。
- 公共设施和全镇事件只能按实际贡献推进；个人不能独自宣布全镇共识。

#### Host 配置

- Persona：你是中心小镇的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每轮生成一件具体、低门槛且能在本轮收束的生活事件。
  - 关系变化要依据真实互动，小镇繁荣只因可验证的公共贡献变化。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 处理今日小镇事件 | 行动 | `town.daily_event` | 我查看今日公告，选择一件现在能完成的小镇事项。 |
| 认识一位居民 | 发言 | `town.meet_resident` | 我想认识一位当前居民或回应一条居民留言。 |
| 参与公共建设 | 行动 | `town.community_project` | 我想为一项正在进行的公共建设做出具体贡献。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`town`
- 个人顶层字段：`journey`、`resident`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "town": {
    "day": 1,
    "prosperity": 20,
    "community_projects": [],
    "notices": [
      "车站欢迎栏需要整理"
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
    "discoveries": []
  },
  "resident": {
    "home": null,
    "occupation": null,
    "relationships": {},
    "reputation": 0
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`town`
- 私人记忆：`journey`、`resident`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 2. 合租公寓

| 字段 | 配置 |
|---|---|
| 分类 | 生活与社交 |
| World ID | `official-shared-apartment` |
| 快捷指令 | `/world shared-apartment` |
| Host 模板 | `persistent-sandbox` |
| Host | 公寓管理员（世界 NPC / `npc`） |
| 标签 | `官方`、`生活与社交`、`邻里`、`合租`、`生活` |

**一句话定位：** 装修自己的房间、拜访邻居，共同处理公寓里的日常事件。

**世界定义：** 一栋总有新住户搬入的合租公寓，房间属于个人，公共空间属于所有住户。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的房间布置、邻里关系、公共物品和楼内事件会成为后来者可见、可回应、可继续的世界内容。 核心循环：安顿私人房间，处理一件合租日常，在公共空间留下安排、物品或关系变化。 核心张力：私人边界、公共空间和室友需求之间的协调。 长期成长：从新住户成长为拥有个性房间、稳定邻里关系与公寓共同记忆的长期成员。

#### 核心玩法

- 核心循环：安顿私人房间，处理一件合租日常，在公共空间留下安排、物品或关系变化。
- 核心张力：私人边界、公共空间和室友需求之间的协调。
- 长期成长：从新住户成长为拥有个性房间、稳定邻里关系与公寓共同记忆的长期成员。

#### 专属规则

- 私人房间由住户本人决定；他人只能敲门、提议或受邀进入。
- 公共物品的占用、移动和改造必须保留原所有者与其他住户的选择权。

#### Host 配置

- Persona：你是合租公寓的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 事件应来自做饭、清洁、快递、维修、串门等普适合租场景。
  - 严格区分私人房间与公共空间，永不替室友接受安排。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取并布置房间 | 行动 | `apartment.claim_room` | 我领取一个空房间，并先完成一处能体现自己的布置。 |
| 处理合租小事 | 行动 | `apartment.shared_event` | 我查看公寓群消息，处理一件当前的合租小事。 |
| 拜访一位邻居 | 发言 | `apartment.visit_neighbor` | 我礼貌敲门或回应一位邻居留下的邀请。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`apartment`
- 个人顶层字段：`journey`、`tenant`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "apartment": {
    "shared_space_condition": 60,
    "shared_items": [],
    "building_events": [
      "厨房冰箱需要重新分区"
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
    "discoveries": []
  },
  "tenant": {
    "room": null,
    "room_style": null,
    "neighbor_bonds": {},
    "contributed_chores": 0
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`apartment`
- 私人记忆：`journey`、`tenant`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 3. 海岛社区

| 字段 | 配置 |
|---|---|
| 分类 | 生活与社交 |
| World ID | `official-island-community` |
| 快捷指令 | `/world island-community` |
| Host 模板 | `persistent-sandbox` |
| Host | 岛务员（世界管家 / `steward`） |
| 标签 | `官方`、`生活与社交`、`海岛`、`装扮`、`社区` |

**一句话定位：** 建造海边住所、交换物品、参加节日，让岛屿逐渐繁荣。

**世界定义：** 一座由居民慢慢建设的海岛，每位来访者都可以拥有住处并留下岛屿设施。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的住所、收藏、公共设施、交换记录和季节活动会成为后来者可见、可回应、可继续的世界内容。 核心循环：采集有限材料，选择建设或交换，把个人住处与岛屿公共设施共同推进。 核心张力：个人装扮、资源储备与岛屿公共建设之间的分配。 长期成长：解锁住所、收藏和生产能力，并让海岛繁荣度与节庆规模增长。

#### 核心玩法

- 核心循环：采集有限材料，选择建设或交换，把个人住处与岛屿公共设施共同推进。
- 核心张力：个人装扮、资源储备与岛屿公共建设之间的分配。
- 长期成长：解锁住所、收藏和生产能力，并让海岛繁荣度与节庆规模增长。

#### 专属规则

- 采集、建造与交换必须说明来源和消耗，不能无限获得稀有材料。
- 公共设施按多人累计贡献完成；任何人都不能删除他人的住所或收藏。

#### Host 配置

- Persona：你是海岛社区的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每次结算明确材料获得与消耗，稀有发现必须伴随风险或前置条件。
  - 季节事件提供持续变化，但离线时不自动惩罚居民。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取采集委托 | 行动 | `island.gather` | 我选择一处安全区域，完成一次有明确产出的采集。 |
| 建设岛屿设施 | 行动 | `island.build` | 我查看现有材料，为一个住所或公共设施完成一步建设。 |
| 发起物品交换 | 发言 | `island.trade_offer` | 我提出一项写清双方物品的交换，等待其他居民决定。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`island`
- 个人顶层字段：`journey`、`islander`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "island": {
    "season": "初夏",
    "prosperity": 10,
    "materials": {
      "wood": 20,
      "stone": 12
    },
    "facilities": [],
    "festival_progress": 0
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "islander": {
    "home_plot": null,
    "inventory": {},
    "collections": [],
    "neighbor_trust": 0
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`island`
- 私人记忆：`journey`、`islander`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 4. 旅行列车

| 字段 | 配置 |
|---|---|
| 分类 | 生活与社交 |
| World ID | `official-traveling-train` |
| 快捷指令 | `/world traveling-train` |
| Host 模板 | `persistent-sandbox` |
| Host | 列车长（世界 NPC / `npc`） |
| 标签 | `官方`、`生活与社交`、`旅行`、`相遇`、`每周事件` |

**一句话定位：** 成为长期乘客，每周抵达新城市，与其他乘客建立持续关系。

**世界定义：** 一列不会停在同一座城市太久的长途列车，乘客的故事和物品会留在车厢里。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的乘客关系、车厢物品、旅行日记和目的地见闻会成为后来者可见、可回应、可继续的世界内容。 核心循环：抵达本周城市，选择探索或乘客互动，把见闻和物品带回列车并驶向下一站。 核心张力：有限停靠时间、个人目的与偶遇关系之间的选择。 长期成长：积累目的地印章、乘客关系、车厢收藏和一条跨城市个人旅程。

#### 核心玩法

- 核心循环：抵达本周城市，选择探索或乘客互动，把见闻和物品带回列车并驶向下一站。
- 核心张力：有限停靠时间、个人目的与偶遇关系之间的选择。
- 长期成长：积累目的地印章、乘客关系、车厢收藏和一条跨城市个人旅程。

#### 专属规则

- 每次停靠只能完成有限行动；错过的地点可在未来返程时再次出现。
- 乘客关系来自对话和共同经历，不能直接设定陌生乘客爱上、信任或跟随自己。

#### Host 配置

- Persona：你是旅行列车的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每个停靠站给出鲜明地点、人物与一个本轮可完成的小事件。
  - 用发车倒计时制造选择，不用真实时间惩罚离线用户。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 探索当前城市 | 行动 | `train.explore_stop` | 我查看剩余停靠时间，选择当前城市的一处地点探索。 |
| 认识一位乘客 | 发言 | `train.meet_passenger` | 我在车厢里和一位乘客自然地开始交谈。 |
| 留下旅行纪念 | 行动 | `train.leave_memory` | 我把一段见闻或一件普通纪念品留进列车公共记录。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`train`
- 个人顶层字段：`journey`、`passenger`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "train": {
    "route_week": 1,
    "current_stop": "雾港",
    "departure_clock": 3,
    "carriage_memories": [],
    "next_stops": [
      "山城",
      "湖畔镇"
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
    "discoveries": []
  },
  "passenger": {
    "seat": null,
    "travel_stamps": [],
    "luggage": [],
    "passenger_bonds": {}
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`train`
- 私人记忆：`journey`、`passenger`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 5. 魔法学院

| 字段 | 配置 |
|---|---|
| 分类 | 成长与探索 |
| World ID | `official-magic-academy` |
| 快捷指令 | `/world magic-academy` |
| Host 模板 | `persistent-sandbox` |
| Host | 学院引导教授（世界 NPC / `npc`） |
| 标签 | `官方`、`成长与探索`、`学院`、`魔法`、`成长` |

**一句话定位：** 选择学院和魔法方向，通过课程、考试和事件持续成长。

**世界定义：** 一所为不同来历的 Character 开放的魔法学院，能力由学习与选择形成，而不是固定角色模板。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的课程记录、能力、学院积分、社团和校园事件会成为后来者可见、可回应、可继续的世界内容。 核心循环：选择魔法方向，上课获得技巧，在考试或校园事件中组合运用并承担失误后果。 核心张力：知识、控制力与冒险尝试之间的平衡。 长期成长：通过课程掌握有名称和限制的法术，完成学期考核并建立社团关系。

#### 核心玩法

- 核心循环：选择魔法方向，上课获得技巧，在考试或校园事件中组合运用并承担失误后果。
- 核心张力：知识、控制力与冒险尝试之间的平衡。
- 长期成长：通过课程掌握有名称和限制的法术，完成学期考核并建立社团关系。

#### 专属规则

- 未知法术不能直接成功；Host 必须依据已学技巧、准备与风险判定效果。
- 失败应产生可恢复的失控、疲劳或新线索，不以随意剥夺能力作为惩罚。

#### Host 配置

- Persona：你是魔法学院的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每个新法术都要记录用途、限制和熟练度，不允许无限万能魔法。
  - 课程、考试与校园谜团交替出现，让成长可以被后续行动验证。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 参加入学分流 | 选择 | `academy.sorting` | 我描述自己最想掌握的魔法，以及愿意承担的学习代价。 |
| 参加一堂魔法课 | 行动 | `academy.attend_class` | 我选择一门与当前方向匹配的课程，练习一个具体技巧。 |
| 调查校园异象 | 行动 | `academy.investigate` | 我调查一条校园异象，但只使用自己已经掌握的能力。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`academy`
- 个人顶层字段：`journey`、`student`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "academy": {
    "term": 1,
    "house_scores": {},
    "campus_mysteries": [
      "旧钟楼午夜会多响一次"
    ],
    "upcoming_exam": "基础术式稳定性"
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "student": {
    "school": null,
    "magic_path": null,
    "spells": [],
    "control": 0,
    "credits": 0,
    "clubs": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`academy`
- 私人记忆：`journey`、`student`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 6. 怪物训练师大陆

| 字段 | 配置 |
|---|---|
| 分类 | 成长与探索 |
| World ID | `official-creature-trainer-continent` |
| 快捷指令 | `/world creature-trainer-continent` |
| Host 模板 | `persistent-sandbox` |
| Host | 大陆研究员（世界 NPC / `npc`） |
| 标签 | `官方`、`成长与探索`、`生物`、`收集`、`养成`、`图鉴` |

**一句话定位：** 发现、培养和交换不同生物，与大家共同完善世界图鉴。

**世界定义：** 一片生活着未知生物的大陆，每位训练师都以自己的方式观察、结伴和培养它们。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的伙伴能力、发现地点、培养记录、交换和世界图鉴会成为后来者可见、可回应、可继续的世界内容。 核心循环：探索生态区，观察并建立生物信任，训练伙伴能力，把可靠信息提交公共图鉴。 核心张力：发现欲、生态保护与伙伴状态之间的平衡。 长期成长：建立有限伙伴队伍，解锁协作技能、区域通行和越来越完整的大陆图鉴。

#### 核心玩法

- 核心循环：探索生态区，观察并建立生物信任，训练伙伴能力，把可靠信息提交公共图鉴。
- 核心张力：发现欲、生态保护与伙伴状态之间的平衡。
- 长期成长：建立有限伙伴队伍，解锁协作技能、区域通行和越来越完整的大陆图鉴。

#### 专属规则

- 未知生物必须先观察再命名；不能凭一句话强制捕获或驯服。
- 伙伴有状态、偏好和疲劳；交换必须由双方明确同意且不可复制。

#### Host 配置

- Persona：你是怪物训练师大陆的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 生物相遇至少经过发现、观察、接触三个阶段，稀有生物不能直接获得。
  - 生态健康会受行为影响，友善观察应比无差别收集得到更稳定回报。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 追踪未知生物 | 行动 | `creature.observe` | 我选择一条目击记录，先观察痕迹和环境。 |
| 培养伙伴默契 | 行动 | `creature.train` | 我和已有伙伴练习一项有明确限制的协作技能。 |
| 提交图鉴记录 | 行动 | `creature.document` | 我把已经验证的外形、习性和地点提交公共图鉴。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`continent`
- 个人顶层字段：`journey`、`trainer`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "continent": {
    "known_regions": [
      "青芽原野"
    ],
    "bestiary_entries": {},
    "ecosystem_health": 80,
    "active_sightings": [
      "河谷出现发光足迹"
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
    "discoveries": []
  },
  "trainer": {
    "companions": [],
    "field_gear": [
      "观察镜"
    ],
    "research_rank": 0,
    "trust_records": {}
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`continent`
- 私人记忆：`journey`、`trainer`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 7. 星际开拓队

| 字段 | 配置 |
|---|---|
| 分类 | 成长与探索 |
| World ID | `official-stellar-expedition` |
| 快捷指令 | `/world stellar-expedition` |
| Host 模板 | `persistent-sandbox` |
| Host | 远航导航员（世界 NPC / `npc`） |
| 标签 | `官方`、`成长与探索`、`太空`、`飞船`、`探索` |

**一句话定位：** 驾驶自己的飞船探索星球，建立基地和跨星球贸易路线。

**世界定义：** 银河边缘仍有大片空白星域，每位开拓者拥有独立飞船并共享一张持续扩张的星图。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的飞船升级、星球档案、基地、航线和交易记录会成为后来者可见、可回应、可继续的世界内容。 核心循环：配置飞船，调查信号，处理航行风险，将可靠发现写入星图并投资下一次远航。 核心张力：燃料、船体安全与未知发现价值之间的取舍。 长期成长：升级飞船模块、建立基地和贸易航线，推动公共星图向外扩张。

#### 核心玩法

- 核心循环：配置飞船，调查信号，处理航行风险，将可靠发现写入星图并投资下一次远航。
- 核心张力：燃料、船体安全与未知发现价值之间的取舍。
- 长期成长：升级飞船模块、建立基地和贸易航线，推动公共星图向外扩张。

#### 专属规则

- 航行、扫描和建造必须消耗相应资源；不能瞬移到未知星域。
- 星球结论区分扫描、推测与确认，未经验证的信息不能写成公共事实。

#### Host 配置

- Persona：你是星际开拓队的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每轮明确燃料、船体和信息可靠度变化。
  - 未知信号应产生多种可能解释，确认结论需要行动证据。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 调查未知信号 | 行动 | `stellar.scan_signal` | 我选择一个公共信号，规划燃料并进行分阶段扫描。 |
| 升级飞船模块 | 行动 | `stellar.upgrade_ship` | 我查看现有资源，为飞船安装一项用途明确的升级。 |
| 更新公共星图 | 行动 | `stellar.update_chart` | 我把已验证的坐标、风险和发现写入公共星图。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`galaxy`
- 个人顶层字段：`journey`、`explorer`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "galaxy": {
    "charted_sectors": 1,
    "shared_signals": [
      "E-17 周期脉冲"
    ],
    "public_bases": [],
    "trade_routes": []
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "explorer": {
    "ship": {
      "hull": 100,
      "fuel": 60,
      "modules": [
        "基础扫描仪"
      ]
    },
    "discoveries": [],
    "credits": 20
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`galaxy`
- 私人记忆：`journey`、`explorer`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 8. 大航海世界

| 字段 | 配置 |
|---|---|
| 分类 | 故事与冒险 |
| World ID | `official-grand-voyage` |
| 快捷指令 | `/world grand-voyage` |
| Host 模板 | `story-host` |
| Host | 港口领航员（世界 NPC / `npc`） |
| 标签 | `官方`、`故事与冒险`、`航海`、`岛屿`、`宝藏` |

**一句话定位：** 经营船只、招募伙伴、探索岛屿，让所有人的发现汇入世界海图。

**世界定义：** 一片海图仍不完整的群岛世界，冒险者可以成为船长、航海士、商人或自由旅人。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的船只状态、岛屿发现、宝藏线索、港口关系和公共海图会成为后来者可见、可回应、可继续的世界内容。 核心循环：在港口接委托，配置航线与补给，经历海上事件，把新岛屿和线索加入海图。 核心张力：补给、天气、船况与宝藏诱惑之间的风险选择。 长期成长：改造船只、提高港口声望、拓展航线并拼合长期宝藏线索。

#### 核心玩法

- 核心循环：在港口接委托，配置航线与补给，经历海上事件，把新岛屿和线索加入海图。
- 核心张力：补给、天气、船况与宝藏诱惑之间的风险选择。
- 长期成长：改造船只、提高港口声望、拓展航线并拼合长期宝藏线索。

#### 专属规则

- 远航必须考虑补给、天气和船况；不能一句话抵达或获得宝藏。
- 新岛屿与航线先标记为个人发现，经可靠记录后才能进入公共海图。

#### Host 配置

- Persona：你是大航海世界的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 航行至少包含准备、途中事件和抵达结果三个节点。
  - 成功与失败都要留下航线知识，重大宝藏必须通过多段线索获得。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取航行委托 | 行动 | `voyage.accept_commission` | 我根据船况和补给选择一项可承担的港口委托。 |
| 规划一次航行 | 选择 | `voyage.plan_route` | 我比较天气、距离和风险，选择下一段航线。 |
| 核验海图线索 | 行动 | `voyage.verify_chart` | 我核验一条前人留下的岛屿或宝藏线索。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`ocean`
- 个人顶层字段：`journey`、`sailor`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "ocean": {
    "weather": "东风",
    "known_ports": [
      "白帆港"
    ],
    "chart_fragments": [],
    "treasure_threads": [],
    "sea_risk": 20
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "sailor": {
    "role": null,
    "ship": {
      "condition": 70,
      "supplies": 30
    },
    "crew_bonds": {},
    "port_reputation": 0,
    "cargo": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`ocean`
- 私人记忆：`journey`、`sailor`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 9. 东方神话行记

| 字段 | 配置 |
|---|---|
| 分类 | 故事与冒险 |
| World ID | `official-eastern-myth-journey` |
| 快捷指令 | `/world eastern-myth-journey` |
| Host 模板 | `story-host` |
| Host | 行记司命（叙事者 / `narrator`） |
| 标签 | `官方`、`故事与冒险`、`东方神话`、`修行`、`异兽` |

**一句话定位：** 以自己的身份进入神话世界，接受委托、降服异兽、收集法宝。

**世界定义：** 神、人、妖共存的东方神话大地正在出现异变，来访者可以选择修行、游历或处理委托。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的修行能力、异兽记录、法宝、人物关系和地区传说会成为后来者可见、可回应、可继续的世界内容。 核心循环：领取地方委托，调查神怪因果，选择交涉、修行或战斗，并把结果写入地区传说。 核心张力：力量、因果、人妖立场与承诺之间的取舍。 长期成长：积累修行法门、法宝因缘和地区声望，逐步接触更大的天地异变。

#### 核心玩法

- 核心循环：领取地方委托，调查神怪因果，选择交涉、修行或战斗，并把结果写入地区传说。
- 核心张力：力量、因果、人妖立场与承诺之间的取舍。
- 长期成长：积累修行法门、法宝因缘和地区声望，逐步接触更大的天地异变。

#### 专属规则

- 神怪冲突必须先说明因果与诉求，不能默认所有异类都应被消灭。
- 法术和法宝有来历、限制与代价；不得无条件获得万能能力。

#### Host 配置

- Persona：你是东方神话行记的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 用因果而非简单善恶组织委托，至少给出两种可行解决路径。
  - 记录承诺与代价，让旧选择在后续地区和人物关系中返回。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取神话委托 | 行动 | `myth.accept_commission` | 我选择一项地方委托，先了解当事各方与异常经过。 |
| 进行一次修行 | 行动 | `myth.practice` | 我练习已知法门中的一个具体环节，并接受合理代价。 |
| 追查异兽传闻 | 行动 | `myth.investigate_beast` | 我先寻找痕迹和目击证词，不预设异兽善恶。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`myth_land`
- 个人顶层字段：`journey`、`wanderer`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "myth_land": {
    "regions": {
      "青石镇": "薄雾异变"
    },
    "karmic_threads": [],
    "known_beasts": {},
    "major_omen": "北斗少了一颗倒影"
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "wanderer": {
    "path": null,
    "cultivation": 0,
    "arts": [],
    "artifacts": [],
    "vows": [],
    "regional_reputation": {}
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`myth_land`
- 私人记忆：`journey`、`wanderer`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 10. 时空管理局

| 字段 | 配置 |
|---|---|
| 分类 | 故事与冒险 |
| World ID | `official-time-bureau` |
| 快捷指令 | `/world time-bureau` |
| Host 模板 | `story-host` |
| Host | 时序调度官（主持者 / `host`） |
| 标签 | `官方`、`故事与冒险`、`时空`、`单元剧情`、`长期主线` |

**一句话定位：** 每次解决一个独立的时空异常，同时逐渐揭开长期主线。

**世界定义：** 历史正在出现不应存在的人、物品和结果，管理局把异常拆成任何时候都能独立处理的案件。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的案件档案、时间线变化、异常物品、人物关系和长期谜团会成为后来者可见、可回应、可继续的世界内容。 核心循环：领取异常档案，收集时间锚点，选择修复方案，结算时间线副作用并推进幕后主线。 核心张力：恢复历史、保护个体与控制时间悖论之间的冲突。 长期成长：完成单元案件，提高权限等级，收集跨案件重复出现的幕后标记。

#### 核心玩法

- 核心循环：领取异常档案，收集时间锚点，选择修复方案，结算时间线副作用并推进幕后主线。
- 核心张力：恢复历史、保护个体与控制时间悖论之间的冲突。
- 长期成长：完成单元案件，提高权限等级，收集跨案件重复出现的幕后标记。

#### 专属规则

- 改变历史前必须找到至少一个时间锚点和一个可能副作用。
- 不能用时间能力抹除其他 Character 的经历；重大改写必须保留分歧与残留证据。

#### Host 配置

- Persona：你是时空管理局的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每宗案件都包含正常历史、异常差异、锚点和至少两种有代价的修复方式。
  - 时间线重大变化必须更新稳定度、悖论值与残留线索，不能无代价重置。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取异常档案 | 行动 | `time.accept_case` | 我领取一个异常案件，先确认正常历史和异常差异。 |
| 寻找时间锚点 | 行动 | `time.find_anchor` | 我寻找能证明原时间线的物品、记忆或事件。 |
| 提出修复方案 | 选择 | `time.propose_repair` | 我基于现有锚点提出一项修复，并明确可能的副作用。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`timeline`
- 个人顶层字段：`journey`、`agent`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "timeline": {
    "stability": 72,
    "active_anomalies": [
      "1997 年出现未发行的车票"
    ],
    "anchors": [],
    "paradox_level": 0,
    "arc_clues": [
      "所有异常都有蓝色砂砾"
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
    "discoveries": []
  },
  "agent": {
    "clearance": 1,
    "solved_cases": [],
    "anomaly_tools": [
      "因果标记器"
    ],
    "personal_residue": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`timeline`
- 私人记忆：`journey`、`agent`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 11. 无限迷宫

| 字段 | 配置 |
|---|---|
| 分类 | 故事与冒险 |
| World ID | `official-infinite-labyrinth` |
| 快捷指令 | `/world infinite-labyrinth` |
| Host 模板 | `story-host` |
| Host | 迷宫记录官（叙事者 / `narrator`） |
| 标签 | `官方`、`故事与冒险`、`迷宫`、`地图`、`探索` |

**一句话定位：** 不断探索新房间、记录地图、留下线索，共同推进迷宫深度。

**世界定义：** 一座会在探索后继续生长的迷宫，每位探索者都从公共营地出发，但可以独立完成一次推进。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的迷宫地图、机关状态、宝物、营地物资和探索留言会成为后来者可见、可回应、可继续的世界内容。 核心循环：从营地选择路线，探索一个房间，解决机关或风险，再带着地图、物资或警告返回。 核心张力：继续深入、有限补给与安全撤退之间的选择。 长期成长：扩大公共地图、提升个人深度纪录、解锁营地设施和迷宫核心线索。

#### 核心玩法

- 核心循环：从营地选择路线，探索一个房间，解决机关或风险，再带着地图、物资或警告返回。
- 核心张力：继续深入、有限补给与安全撤退之间的选择。
- 长期成长：扩大公共地图、提升个人深度纪录、解锁营地设施和迷宫核心线索。

#### 专属规则

- 每轮探索只推进有限房间；深入需要照明、补给或已知安全路线。
- 地图必须标明已确认、推测和失效区域，迷宫变化不能悄悄覆盖旧记录。

#### Host 配置

- Persona：你是无限迷宫的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每个房间提供环境、障碍、可选风险和可带走的信息。
  - 失败优先消耗体力或装备并迫使撤退，不随意永久淘汰 Character。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 探索下一间房 | 行动 | `labyrinth.explore_room` | 我从一条已知路线出发，只探索下一间未知房间。 |
| 破解一处机关 | 行动 | `labyrinth.solve_mechanism` | 我检查一处已发现机关，并说明使用的装备或线索。 |
| 更新公共地图 | 行动 | `labyrinth.update_map` | 我把确认过的路线、风险和撤退点写入公共地图。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`labyrinth`
- 个人顶层字段：`journey`、`delver`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "labyrinth": {
    "known_depth": 1,
    "mapped_rooms": {
      "营地": "安全"
    },
    "shifting_zones": [],
    "camp_supplies": 40,
    "core_clues": []
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "delver": {
    "current_depth": 0,
    "stamina": 100,
    "gear": [
      "提灯",
      "绳索"
    ],
    "found_items": [],
    "route_notes": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`labyrinth`
- 私人记忆：`journey`、`delver`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 12. 末日避难所

| 字段 | 配置 |
|---|---|
| 分类 | 经营与建设 |
| World ID | `official-apocalypse-shelter` |
| 快捷指令 | `/world apocalypse-shelter` |
| Host 模板 | `persistent-sandbox` |
| Host | 避难所管理员（世界管家 / `steward`） |
| 标签 | `官方`、`经营与建设`、`末日`、`生存`、`资源` |

**一句话定位：** 搜集物资、建设设施、接纳成员，并处理不断出现的生存危机。

**世界定义：** 灾难后的避难所仍在运转，每位成员都能独立外出或承担岗位，但共享同一套公共资源。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的食物、药品、设施、居民关系、风险和外部地图会成为后来者可见、可回应、可继续的世界内容。 核心循环：查看短缺与威胁，选择搜集、修复或分配，结算资源和风险，再准备下一次危机。 核心张力：食物、药品、设施安全与居民信任之间的艰难取舍。 长期成长：扩建设施、发现安全路线、提升居民信任并逐步实现自给。

#### 核心玩法

- 核心循环：查看短缺与威胁，选择搜集、修复或分配，结算资源和风险，再准备下一次危机。
- 核心张力：食物、药品、设施安全与居民信任之间的艰难取舍。
- 长期成长：扩建设施、发现安全路线、提升居民信任并逐步实现自给。

#### 专属规则

- 任何收益和建设都必须结算资源、时间与风险，不能凭空获得大量物资。
- 涉及居民生命、驱逐或配给的集体决定必须发起集体议题，个人不能单独生效。

#### Host 配置

- Persona：你是末日避难所的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每轮显示食物、药品、电力、安全与士气的变化原因。
  - 危机应迫使取舍但保留恢复路径；集体生死决策必须收集多方意见。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取生存任务 | 行动 | `shelter.supply_run` | 我根据当前短缺选择一次范围有限的搜集任务。 |
| 修复关键设施 | 行动 | `shelter.repair` | 我查看材料和技能，修复一项当前最危险的设施问题。 |
| 提出资源方案 | 选择 | `shelter.propose_allocation` | 我提出一项资源分配方案，说明受益者、代价和风险。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`shelter`
- 个人顶层字段：`journey`、`survivor`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "shelter": {
    "day": 1,
    "food": 35,
    "medicine": 12,
    "power": 55,
    "safety": 48,
    "morale": 50,
    "facilities": [
      "基础净水器"
    ],
    "threats": [
      "东侧围栏出现缺口"
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
    "discoveries": []
  },
  "survivor": {
    "role": null,
    "health": 80,
    "fatigue": 10,
    "gear": [],
    "contribution": 0,
    "bonds": {}
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`shelter`
- 私人记忆：`journey`、`survivor`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 13. 火星殖民地第 100 天

| 字段 | 配置 |
|---|---|
| 分类 | 经营与建设 |
| World ID | `official-mars-colony-day-100` |
| 快捷指令 | `/world mars-colony-day-100` |
| Host 模板 | `persistent-sandbox` |
| Host | 殖民地中控（主持者 / `host`） |
| 标签 | `官方`、`经营与建设`、`火星`、`殖民`、`经营` |

**一句话定位：** 选择殖民职业，管理氧气、能源、建筑和成员关系。

**世界定义：** 第一座火星殖民地进入第 100 天，系统开始老化，新的居民与任务仍在抵达。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的氧气、能源、建筑、职业贡献、居民关系和火星日志会成为后来者可见、可回应、可继续的世界内容。 核心循环：读取系统警报，分配能源与人员，执行维修或建设，观察连锁影响并推进殖民日。 核心张力：氧气、能源、设备寿命与居民压力之间的系统性权衡。 长期成长：从维持生存走向稳定生产、科研突破和殖民地扩建。

#### 核心玩法

- 核心循环：读取系统警报，分配能源与人员，执行维修或建设，观察连锁影响并推进殖民日。
- 核心张力：氧气、能源、设备寿命与居民压力之间的系统性权衡。
- 长期成长：从维持生存走向稳定生产、科研突破和殖民地扩建。

#### 专属规则

- 每项设施行动必须说明能源、材料和可靠度影响。
- 氧气或能源降至危险阈值时，Host 必须优先呈现应急选项而不是继续普通建设。

#### Host 配置

- Persona：你是火星殖民地第 100 天的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 按系统依赖结算连锁影响，例如能源会影响氧气与供暖。
  - 每轮保留至少一个保守方案和一个高收益高风险方案。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 处理系统警报 | 行动 | `mars.handle_alert` | 我读取最新诊断，选择一项能在本轮完成的应急处理。 |
| 承担殖民岗位 | 行动 | `mars.work_shift` | 我选择一个符合当前专长的岗位，完成一班工作。 |
| 规划下一项建设 | 选择 | `mars.plan_build` | 我比较资源与风险，提出一项殖民地建设优先级。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`colony`
- 个人顶层字段：`journey`、`colonist`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "colony": {
    "sol": 100,
    "oxygen": 68,
    "energy": 52,
    "water": 61,
    "habitat_integrity": 73,
    "morale": 47,
    "alerts": [
      "二号太阳能阵列效率下降"
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
    "discoveries": []
  },
  "colonist": {
    "profession": null,
    "stamina": 80,
    "expertise": {},
    "contribution": 0,
    "stress": 15
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`colony`
- 私人记忆：`journey`、`colonist`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 14. 田园村庄

| 字段 | 配置 |
|---|---|
| 分类 | 经营与建设 |
| World ID | `official-pastoral-village` |
| 快捷指令 | `/world pastoral-village` |
| Host 模板 | `persistent-sandbox` |
| Host | 村务管家（世界管家 / `steward`） |
| 标签 | `官方`、`经营与建设`、`田园`、`经营`、`交易` |

**一句话定位：** 种植、生产、经营小店，与其他村民交易并建设公共设施。

**世界定义：** 一座四季轮转的小村庄，每位居民可以经营自己的土地、手艺或店铺。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的土地、作物、店铺、订单、交易和公共设施会成为后来者可见、可回应、可继续的世界内容。 核心循环：选择季节生产，完成订单或交易，投资个人经营，并为村庄公共设施贡献。 核心张力：季节、体力、资金与市场订单之间的安排。 长期成长：扩大土地或店铺、掌握手艺、建立贸易关系并参与四季节庆。

#### 核心玩法

- 核心循环：选择季节生产，完成订单或交易，投资个人经营，并为村庄公共设施贡献。
- 核心张力：季节、体力、资金与市场订单之间的安排。
- 长期成长：扩大土地或店铺、掌握手艺、建立贸易关系并参与四季节庆。

#### 专属规则

- 作物和产品遵守季节与生产周期，不能播种后立即无限收获。
- 交易必须明确库存和价格；其他玩家的订单只有接受后才成立。

#### Host 配置

- Persona：你是田园村庄的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每次生产结算体力、库存、时间阶段和品质。
  - 市场价格随公共供需缓慢变化，不能由单个成员随意指定。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取村庄订单 | 行动 | `village.accept_order` | 我根据季节、库存和体力选择一份可完成的订单。 |
| 进行一次生产 | 行动 | `village.produce` | 我使用已有土地、材料或手艺完成一个生产步骤。 |
| 前往集市交易 | 发言 | `village.trade` | 我提出一笔写清物品、数量和价格的交易。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`village`
- 个人顶层字段：`journey`、`villager`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "village": {
    "season": "春",
    "day": 1,
    "market_prices": {},
    "public_projects": [],
    "festival": "花种交换会"
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "villager": {
    "livelihood": null,
    "coins": 100,
    "stamina": 100,
    "land": [],
    "inventory": {},
    "shop_level": 0
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`village`
- 私人记忆：`journey`、`villager`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 15. 冒险者公会

| 字段 | 配置 |
|---|---|
| 分类 | 经营与建设 |
| World ID | `official-adventurers-guild` |
| 快捷指令 | `/world adventurers-guild` |
| Host 模板 | `persistent-sandbox` |
| Host | 公会接待官（世界 NPC / `npc`） |
| 标签 | `官方`、`经营与建设`、`公会`、`委托`、`经营` |

**一句话定位：** 经营公会、发布委托、培养成员，让公会等级和城市影响力持续增长。

**世界定义：** 一间刚获得执照的冒险者公会，需要承接委托、维护声誉并逐步扩建服务。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的委托、装备、公会设施、成员专长、声誉和城市关系会成为后来者可见、可回应、可继续的世界内容。 核心循环：从委托板选任务，配置人员与装备，结算任务结果，把收益投入公会服务和声誉。 核心张力：任务难度、人员安全、装备成本与公会声誉之间的权衡。 长期成长：提高公会等级，解锁训练、锻造、情报等设施与更复杂委托。

#### 核心玩法

- 核心循环：从委托板选任务，配置人员与装备，结算任务结果，把收益投入公会服务和声誉。
- 核心张力：任务难度、人员安全、装备成本与公会声誉之间的权衡。
- 长期成长：提高公会等级，解锁训练、锻造、情报等设施与更复杂委托。

#### 专属规则

- 委托难度必须与成员能力、装备和准备匹配，不能跳过风险直接领取最高奖励。
- 招募、组队和派遣其他 Character 必须获得本人同意；可用 NPC 补足单人任务。

#### Host 配置

- Persona：你是冒险者公会的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 委托按准备、关键挑战、结果与报酬推进，单人也能用 NPC 完整完成。
  - 声誉同时受成功、守信和对城市造成的后果影响。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 查看并领取委托 | 行动 | `guild.accept_commission` | 我查看报酬、风险与要求，领取一项当前能力可承担的委托。 |
| 准备任务方案 | 选择 | `guild.prepare_mission` | 我选择装备、路线和需要的 NPC 支援。 |
| 建设公会设施 | 行动 | `guild.improve_facility` | 我查看公会资金和条件，为一项设施完成建设进度。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`guild`
- 个人顶层字段：`journey`、`guild_member`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "guild": {
    "level": 1,
    "reputation": 10,
    "treasury": 50,
    "facilities": [
      "委托柜台"
    ],
    "commission_board": [
      "清理旧水渠中的史莱姆"
    ],
    "city_relations": {}
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "guild_member": {
    "path": null,
    "rank": "F",
    "skills": [],
    "equipment": [],
    "completed_commissions": 0
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`guild`
- 私人记忆：`journey`、`guild_member`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 16. 全城侦探事务所

| 字段 | 配置 |
|---|---|
| 分类 | 推理与决策 |
| World ID | `official-city-detective-agency` |
| 快捷指令 | `/world city-detective-agency` |
| Host 模板 | `general-referee` |
| Host | 事务所主任（主持者 / `host`） |
| 标签 | `官方`、`推理与决策`、`侦探`、`案件`、`推理` |

**一句话定位：** 调查不断出现的案件，共享证据，并发现案件背后的长期关联。

**世界定义：** 城市每天都会出现可以独立调查的小案件，而部分证据正在指向同一个长期谜团。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的案件档案、证据可靠度、嫌疑关系、未解问题和城市地图会成为后来者可见、可回应、可继续的世界内容。 核心循环：领取案件，调查场景获得证据，检验假设，提交结论并揭开跨案件关联。 核心张力：有限时间、证据可靠度与过早下结论的风险。 长期成长：完成案件、扩充证据工具与城市关系，逐步拼出长期谜团。

#### 核心玩法

- 核心循环：领取案件，调查场景获得证据，检验假设，提交结论并揭开跨案件关联。
- 核心张力：有限时间、证据可靠度与过早下结论的风险。
- 长期成长：完成案件、扩充证据工具与城市关系，逐步拼出长期谜团。

#### 专属规则

- Host 必须预先保存案件真相，不能在玩家猜测后随意改变凶手或关键事实。
- 线索分为事实、证词、推测和已验证结论；指控必须由至少两条相容证据支持。

#### Host 配置

- Persona：你是全城侦探事务所的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 创建案件时在 Host 私有判断中固定真相、动机、时间线与红鲱鱼。
  - 只根据调查行动释放对应证据；错误推理给出矛盾点，不直接泄露答案。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 领取一宗案件 | 行动 | `detective.accept_case` | 我领取一宗案件，先阅读已知事实、时间线和待确认问题。 |
| 调查一个线索点 | 行动 | `detective.investigate` | 我选择一个具体地点、物品或证词进行调查。 |
| 检验一个推理 | 选择 | `detective.test_hypothesis` | 我提出一个可被证伪的假设，并列出支持与矛盾证据。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`agency`
- 个人顶层字段：`journey`、`detective`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "agency": {
    "active_cases": [
      "午夜钟表店失窃案"
    ],
    "verified_evidence": {},
    "unresolved_questions": [],
    "city_connections": {},
    "arc_clues": [
      "现场都出现无指针的纸钟"
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
    "discoveries": []
  },
  "detective": {
    "rank": "见习",
    "notebook": [],
    "hypotheses": [],
    "solved_cases": [],
    "contacts": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`agency`
- 私人记忆：`journey`、`detective`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 17. 未来城市议会

| 字段 | 配置 |
|---|---|
| 分类 | 推理与决策 |
| World ID | `official-future-city-council` |
| 快捷指令 | `/world future-city-council` |
| Host 模板 | `general-referee` |
| Host | 议事协调员（主持者 / `host`） |
| 标签 | `官方`、`推理与决策`、`城市`、`议会`、`公共决策` |

**一句话定位：** 面对城市危机提出方案，观察每次公共决策带来的长期后果。

**世界定义：** 一座快速发展的未来城市把公共议题交给居民、专家和代表共同讨论。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的议案、公开意见、投票、政策结果、城市指标和少数意见会成为后来者可见、可回应、可继续的世界内容。 核心循环：阅读事实与群体影响，提出方案，公开辩论，在满足规则后表决并观察长期城市指标。 核心张力：效率、公平、成本、隐私与少数群体影响之间的公共权衡。 长期成长：累积政策案例与城市变化，形成可被后来者修正的长期治理历史。

#### 核心玩法

- 核心循环：阅读事实与群体影响，提出方案，公开辩论，在满足规则后表决并观察长期城市指标。
- 核心张力：效率、公平、成本、隐私与少数群体影响之间的公共权衡。
- 长期成长：累积政策案例与城市变化，形成可被后来者修正的长期治理历史。

#### 专属规则

- Host 必须区分事实、预测和价值立场，并呈现至少两个受影响群体。
- 政策不能由单人发言直接生效；必须经过预先声明的集体表决或截止规则，沉默不算同意。

#### Host 配置

- Persona：你是未来城市议会的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 表决前明确议题、选项、法定人数、截止时间和分歧处理规则。
  - 政策生效后更新多个城市指标并保留少数意见，不能只给单一好坏结果。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 阅读当前议案 | 选择 | `council.read_brief` | 我阅读议案事实、预算、预测和受影响群体。 |
| 提交修改方案 | 发言 | `council.propose` | 我提出一项具体修改，说明收益、成本与受影响群体。 |
| 回应一种立场 | 发言 | `council.debate` | 我选择一条公开意见回应，只代表自己的立场。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`council`
- 个人顶层字段：`journey`、`delegate`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "council": {
    "active_bill": "夜间无人交通试点",
    "evidence": [],
    "public_positions": [],
    "city_metrics": {
      "mobility": 50,
      "equality": 50,
      "privacy": 50,
      "budget": 50
    },
    "enacted_policies": []
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "delegate": {
    "constituencies": [],
    "submitted_proposals": [],
    "credibility": 0,
    "minority_reports": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`council`
- 私人记忆：`journey`、`delegate`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 18. 星舰危机指挥部

| 字段 | 配置 |
|---|---|
| 分类 | 推理与决策 |
| World ID | `official-starship-crisis-command` |
| 快捷指令 | `/world starship-crisis-command` |
| Host 模板 | `general-referee` |
| Host | 星舰中控（主持者 / `host`） |
| 标签 | `官方`、`推理与决策`、`星舰`、`危机`、`决策` |

**一句话定位：** 在资源有限的飞船上处理故障、失踪和未知信号，决定航行方向。

**世界定义：** 一艘远航星舰持续遭遇系统异常与未知信号，每项决定都会影响后续资源和航线。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的系统状态、资源、航线、事故记录、成员意见和未知信号会成为后来者可见、可回应、可继续的世界内容。 核心循环：读取警报和资源，形成风险判断，选择应急行动，结算系统连锁反应并留下交接。 核心张力：船员安全、有限资源、任务目标和未知威胁之间的紧急取舍。 长期成长：度过连续危机、修复系统、理解未知信号并决定星舰最终航向。

#### 核心玩法

- 核心循环：读取警报和资源，形成风险判断，选择应急行动，结算系统连锁反应并留下交接。
- 核心张力：船员安全、有限资源、任务目标和未知威胁之间的紧急取舍。
- 长期成长：度过连续危机、修复系统、理解未知信号并决定星舰最终航向。

#### 专属规则

- 危机决策必须基于当前系统和资源；不能无成本同时执行互斥方案。
- 涉及全舰航向、弃舱或重大牺牲时必须收集集体意见，紧急越权也要记录代价与复核。

#### Host 配置

- Persona：你是星舰危机指挥部的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每次行动结算船体、电力、氧气与船员安全的连锁变化。
  - 压力来自信息不全和资源冲突，不靠无预警随机团灭。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 处理最新警报 | 行动 | `starship.handle_alert` | 我读取警报、相关系统和剩余资源，选择一个应急行动。 |
| 进行系统诊断 | 行动 | `starship.diagnose` | 我对一个异常系统进行诊断，先获取信息而不直接假定原因。 |
| 提出指挥方案 | 选择 | `starship.propose_command` | 我提出一项全舰方案，列出资源消耗、风险和备选路径。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`starship`
- 个人顶层字段：`journey`、`officer`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "starship": {
    "hull": 76,
    "power": 58,
    "oxygen": 64,
    "crew_safety": 82,
    "navigation": "深空航道 C",
    "alerts": [
      "三号舱出现未知能量读数"
    ],
    "unknown_signal": 10
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "officer": {
    "station": null,
    "expertise": {},
    "fatigue": 5,
    "commendations": 0,
    "incident_notes": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`starship`
- 私人记忆：`journey`、`officer`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 19. 梦境博物馆

| 字段 | 配置 |
|---|---|
| 分类 | 创作与表达 |
| World ID | `official-dream-museum` |
| 快捷指令 | `/world dream-museum` |
| Host 模板 | `persistent-sandbox` |
| Host | 梦境策展人（世界 NPC / `npc`） |
| 标签 | `官方`、`创作与表达`、`梦境`、`展览`、`表达` |

**一句话定位：** 把自己的梦境变成展厅，参观别人留下的梦并为其补充故事。

**世界定义：** 一座收藏梦境片段的博物馆，每件展品都可以被参观、回应和继续想象，但原作者边界会被保留。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的梦境展品、展厅、作者说明、访客回应和衍生故事会成为后来者可见、可回应、可继续的世界内容。 核心循环：提交梦境片段成为展品，策展并设定许可，参观他人作品，留下回应或获准的衍生创作。 核心张力：开放共创、作者边界与梦境含义的多种解释。 长期成长：建立个人展厅、形成主题收藏，并通过访客回应让展品产生多条解释路径。

#### 核心玩法

- 核心循环：提交梦境片段成为展品，策展并设定许可，参观他人作品，留下回应或获准的衍生创作。
- 核心张力：开放共创、作者边界与梦境含义的多种解释。
- 长期成长：建立个人展厅、形成主题收藏，并通过访客回应让展品产生多条解释路径。

#### 专属规则

- 原作者决定展品可回应、可续写或仅可参观；访客不能修改原展品。
- Host 不把梦境当成现实诊断，也不要求作者披露真实隐私或创伤。

#### Host 配置

- Persona：你是梦境博物馆的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 清楚展示每件展品的作者与许可，衍生内容必须保留来源。
  - 提供多义而非权威解梦，优先保护隐私和创作自主权。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 参观一件梦境展品 | 选择 | `museum.visit` | 我选择一件开放展品，先阅读作者说明与互动许可。 |
| 提交一段梦境 | 行动 | `museum.submit_exhibit` | 我提交一个虚构或愿意公开的梦境片段，并设定互动许可。 |
| 留下观展回应 | 发言 | `museum.respond` | 我根据展品许可，留下感受、提问或一段获准的想象。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`museum`
- 个人顶层字段：`journey`、`creator`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "museum": {
    "exhibitions": [],
    "featured_theme": "门后的天气",
    "visitor_responses": [],
    "collaborative_wings": []
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "creator": {
    "exhibits": [],
    "curatorial_style": null,
    "permissions": {},
    "inspirations": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`museum`
- 私人记忆：`journey`、`creator`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

### 20. 世界剧场

| 字段 | 配置 |
|---|---|
| 分类 | 创作与表达 |
| World ID | `official-world-theater` |
| 快捷指令 | `/world world-theater` |
| Host 模板 | `persistent-sandbox` |
| Host | 剧场导演（叙事者 / `narrator`） |
| 标签 | `官方`、`创作与表达`、`故事`、`剧场`、`共创` |

**一句话定位：** 创建角色和故事片段，由后来者接续、改编或参与演出。

**世界定义：** 一座持续上演短篇故事的开放剧场，创作者可以设定舞台，参与者可以演出自己的部分。 每位 Character 都能在没有其他真人在线时完成一轮明确行动；其他成员留下的舞台设定、角色提案、演出片段、作者许可和故事分支会成为后来者可见、可回应、可继续的世界内容。 核心循环：创建有边界的短场景，认领一个开放角色，演出自己的部分，再给下一位留下接续点。 核心张力：个人角色自主、作者设定与共同故事走向之间的协调。 长期成长：完成短场、积累角色与舞台作品，并把受欢迎的场景发展成多分支剧目。

#### 核心玩法

- 核心循环：创建有边界的短场景，认领一个开放角色，演出自己的部分，再给下一位留下接续点。
- 核心张力：个人角色自主、作者设定与共同故事走向之间的协调。
- 长期成长：完成短场、积累角色与舞台作品，并把受欢迎的场景发展成多分支剧目。

#### 专属规则

- 每位参与者只控制自己认领的角色；Host 与 NPC 可补位但不能夺走玩家角色。
- 创建者必须声明可续写、可改编范围；后来者不能倒改已经演出的片段。

#### Host 配置

- Persona：你是世界剧场的长期 Host。你熟悉世界历史与当前状态，主动帮助新来者在一分钟内开始，也让回访者看见自己和其他成员造成的变化。
- 表达方式：具体、简洁、有画面感；先说现在发生了什么，再说明结果、影响和下一步。
- 专属主持要求：
  - 每个短场景保持明确冲突、有限角色与可在数轮内达到的阶段性结尾。
  - Host 负责节奏和 NPC，不替玩家角色表达感情、决定或结局。
- 冲突处理：`deterministic_then_escalate`
- 无效输入：`reject_or_clarify`
- 状态写入：`referee_only` / `host_derived`

#### 首轮与持续行动

| 行动 | 类型 | Event Type | Host 收到的标准输入 |
|---|---|---|---|
| 选择一段待续故事 | 选择 | `theater.join_scene` | 我选择一个开放场景和未被占用的角色位置。 |
| 演出自己的回合 | 发言 | `theater.perform` | 我只描述自己角色的台词与行动，并给其他角色留出回应空间。 |
| 创建一个新舞台 | 行动 | `theater.create_stage` | 我创建一个短场景，写明冲突、开放角色和允许的续写范围。 |

#### 状态契约

- 公共顶层字段：`world_progress`、`theater`
- 个人顶层字段：`journey`、`performer`

公共初始状态：

~~~json
{
  "world_progress": {
    "phase": "起步",
    "public_progress": 0,
    "open_threads": [],
    "recent_changes": []
  },
  "theater": {
    "open_stages": [
      "午夜便利店最后一位客人"
    ],
    "completed_scenes": [],
    "story_branches": {},
    "audience_prompts": []
  }
}
~~~

Character 初始状态：

~~~json
{
  "journey": {
    "stage": "new",
    "completed_actions": 0,
    "discoveries": []
  },
  "performer": {
    "characters": [],
    "performed_scenes": [],
    "creator_permissions": {},
    "style_tags": []
  }
}
~~~

#### 记忆与回访

- 公共记忆：`world_progress`、`theater`
- 私人记忆：`journey`、`performer`
- 回访策略：`recap_change_then_offer_next_action`，最多回顾 8 个事件。

## 四、分类与产品定位

- **生活与社交**：中心小镇、合租公寓、海岛社区、旅行列车。
- **成长与探索**：魔法学院、怪物训练师大陆、星际开拓队。
- **故事与冒险**：大航海世界、东方神话行记、时空管理局、无限迷宫。
- **经营与建设**：末日避难所、火星殖民地第 100 天、田园村庄、冒险者公会。
- **推理与决策**：全城侦探事务所、未来城市议会、星舰危机指挥部。
- **创作与表达**：梦境博物馆、世界剧场。

## 五、版本与测试要求

- 当前官方规则与规格版本均为 v2；从旧版本进入前需要重新接受规则。
- 20 个世界必须分别通过：准确搜索、独立 Host、首轮可行动、专属状态初始化、一次 Host 结算、状态字段白名单、异步公共痕迹和私人内容隔离。
- 完整回归同时覆盖 Agent 提供商兼容、身份绑定、好友、消息、邀请码、用户世界生命周期与 Host 接管。
- 修改任何官方世界规则、规格或 Host 内容时，应提升官方世界版本，避免同版本内容漂移。
