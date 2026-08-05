import {
  OFFICIAL_WORLD_CATEGORIES,
  OFFICIAL_WORLDS,
  OFFICIAL_WORLD_VERSION,
} from "../src/venue-lab-core/official-worlds.js";

const lines = [];
const add = (...items) => lines.push(...items);
const json = (value) => JSON.stringify(value, null, 2);
const tick = String.fromCharCode(96);
const code = (value) => tick + value + tick;
const roleLabel = {
  host: "主持者",
  npc: "世界 NPC",
  narrator: "叙事者",
  steward: "世界管家",
};
const inputLabel = { action: "行动", speech: "发言", choice: "选择" };

add(
  "# 20 个官方世界完整配置说明",
  "",
  "> 配置版本：Official World v" + OFFICIAL_WORLD_VERSION,
  "> 代码来源：" + code("src/venue-lab-core/official-worlds.js"),
  "> 本文描述官方世界当前实际运行配置，包括发现入口、玩法循环、规则、Host、状态和快捷行动。",
  "",
  "## 一、统一运行模型",
  "",
  "### 1. 身份与进入",
  "",
  "- 玩家身份统一称为 Character，不限定宠物、人类、机器人或其他外形。",
  "- 20 个官方世界均为 public + open：可公开发现，接受当前规则版本后即可加入。",
  "- 每个世界都有稳定 World ID 和 /world <slug> 快捷指令；快捷指令只负责准确定位世界，仍需完成规则确认、加入和进入。",
  "- 每个世界支持单人独立体验、多人同时参与和异步接力；没有其他真人在线时，Host 与世界 NPC 补足必要互动。",
  "",
  "### 2. Host 执行与上下文隔离",
  "",
  "- 每个世界拥有独立 world-agent:<world-id>、Host 配置、状态与事件历史。",
  "- 本地 Codex 执行模式使用“一世界一持久任务”，上下文隔离标记为 one_thread_per_world。",
  "- 默认最多同时运行 2 个 Host Turn，更多世界进入队列；这限制并发处理量，不限制可创建或可加入的世界数量。",
  "- Host 只能使用 world: 范围能力，不得调用 shell、文件、浏览器、消息或其他外部工具。",
  "- Host 输出采用结构化裁决：decision、resolution_disposition、原因、结果及可选状态补丁。",
  "",
  "### 3. 统一参与策略",
  "",
  "~~~json",
  json(OFFICIAL_WORLDS[0].host.participationPolicy),
  "~~~",
  "",
  "- 世界始终共享；独立行动同样可能影响公共状态。",
  "- 其他 Character 的沉默不代表同意，也不会阻塞可独立完成的行动。",
  "- 涉及全体的真实集体决策必须声明窗口或法定人数、截止规则、迟到输入策略与分歧处理规则。",
  "",
  "### 4. 统一持久化策略",
  "",
  "~~~json",
  json(OFFICIAL_WORLDS[0].host.evolutionPolicy),
  "~~~",
  "",
  "- 世界由成员输入、Host 结果和已配置时间触发器推进。",
  "- 无人参与时暂停，不因离线自动惩罚 Character。",
  "- 公共状态存放在 world_state；个人旅程存放在 member_state。",
  "- v1 升级 v2 时保留已有进度，并为世界与成员状态补齐新增默认字段。",
  "",
  "### 5. 统一安全与自主权规则",
  "",
);
for (const rule of OFFICIAL_WORLDS[0].rules.split("\n").slice(0, 5)) {
  add("- " + rule.replace(/^\d+\.\s*/, ""));
}
add(
  "",
  "### 6. Host 通用裁决优先级",
  "",
  "1. 平台安全边界。",
  "2. 当前世界规则。",
  "3. Character 自主权。",
  "4. 当前状态一致性与并发版本。",
  "",
  "Host 是唯一可提交状态变化的裁决者。每个世界额外声明允许修改的公共/个人顶层字段；未声明字段会以 WORLD_STATE_CONTRACT_VIOLATION 拒绝。",
  "",
  "## 二、目录总览",
  "",
  "| # | 分类 | 世界 | World ID | 快捷指令 | Host |",
  "|---:|---|---|---|---|---|",
);
OFFICIAL_WORLDS.forEach((world, index) => {
  add(
    "| " + (index + 1) + " | " + world.category + " | " + world.name +
      " | " + code(world.id) + " | " + code(world.shortcut) + " | " +
      world.host.name + " |",
  );
});
add("", "## 三、逐世界配置", "");

OFFICIAL_WORLDS.forEach((world, index) => {
  const mechanics = world.host.judgementPolicy.world_mechanics;
  const uniqueRules = world.rules
    .split("\n")
    .filter((line) => /^[67]\./.test(line));
  const actions = world.host.onboardingPolicy.solo_choices;
  add(
    "### " + (index + 1) + ". " + world.name,
    "",
    "| 字段 | 配置 |",
    "|---|---|",
    "| 分类 | " + world.category + " |",
    "| World ID | " + code(world.id) + " |",
    "| 快捷指令 | " + code(world.shortcut) + " |",
    "| Host 模板 | " + code(world.templateId) + " |",
    "| Host | " + world.host.name + "（" +
      (roleLabel[world.host.worldRole] ?? world.host.worldRole) + " / " +
      code(world.host.worldRole) + "） |",
    "| 标签 | " + world.tags.map(code).join("、") + " |",
    "",
    "**一句话定位：** " + world.description,
    "",
    "**世界定义：** " + world.definition.replace(/\n+/g, " "),
    "",
    "#### 核心玩法",
    "",
    "- 核心循环：" + mechanics.core_loop,
    "- 核心张力：" + mechanics.core_tension,
    "- 长期成长：" + mechanics.progression,
    "",
    "#### 专属规则",
    "",
  );
  for (const rule of uniqueRules) {
    add("- " + rule.replace(/^\d+\.\s*/, ""));
  }
  add(
    "",
    "#### Host 配置",
    "",
    "- Persona：" + world.host.personaText,
    "- 表达方式：" + world.host.speakingStyle,
    "- 专属主持要求：",
  );
  for (const directive of mechanics.host_directives) {
    add("  - " + directive);
  }
  add(
    "- 冲突处理：" + code(world.host.judgementPolicy.conflicts),
    "- 无效输入：" + code(world.host.judgementPolicy.invalid_input),
    "- 状态写入：" + code(world.host.judgementPolicy.state_writes) + " / " +
      code(world.host.judgementPolicy.state_patch_policy),
    "",
    "#### 首轮与持续行动",
    "",
    "| 行动 | 类型 | Event Type | Host 收到的标准输入 |",
    "|---|---|---|---|",
  );
  for (const action of actions) {
    add(
      "| " + action.label + " | " +
        (inputLabel[action.input_type] ?? action.input_type) + " | " +
        code(action.event_type) + " | " +
        action.body_text.replace(/\|/g, "\\|") + " |",
    );
  }
  add(
    "",
    "#### 状态契约",
    "",
    "- 公共顶层字段：" +
      mechanics.state_contract.world_top_level_keys.map(code).join("、"),
    "- 个人顶层字段：" +
      mechanics.state_contract.member_top_level_keys.map(code).join("、"),
    "",
    "公共初始状态：",
    "",
    "~~~json",
    json(world.initialState),
    "~~~",
    "",
    "Character 初始状态：",
    "",
    "~~~json",
    json(world.initialMemberState),
    "~~~",
    "",
    "#### 记忆与回访",
    "",
    "- 公共记忆：" +
      world.host.memoryPolicy.information_partitions[0].contains
        .map(code)
        .join("、"),
    "- 私人记忆：" +
      world.host.memoryPolicy.information_partitions[1].contains
        .map(code)
        .join("、"),
    "- 回访策略：" + code(world.host.memoryPolicy.return_strategy) +
      "，最多回顾 " + world.host.recapPolicy.max_events + " 个事件。",
    "",
  );
});

add("## 四、分类与产品定位", "");
for (const category of OFFICIAL_WORLD_CATEGORIES) {
  const worlds = OFFICIAL_WORLDS.filter((world) => world.category === category);
  add("- **" + category + "**：" + worlds.map((world) => world.name).join("、") + "。");
}
add(
  "",
  "## 五、版本与测试要求",
  "",
  "- 当前官方规则与规格版本均为 v2；从旧版本进入前需要重新接受规则。",
  "- 20 个世界必须分别通过：准确搜索、独立 Host、首轮可行动、专属状态初始化、一次 Host 结算、状态字段白名单、异步公共痕迹和私人内容隔离。",
  "- 完整回归同时覆盖 Agent 提供商兼容、身份绑定、好友、消息、邀请码、用户世界生命周期与 Host 接管。",
  "- 修改任何官方世界规则、规格或 Host 内容时，应提升官方世界版本，避免同版本内容漂移。",
);

process.stdout.write(lines.join("\n") + "\n");
