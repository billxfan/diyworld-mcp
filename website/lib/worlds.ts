export type WorldCategory = "social" | "growth" | "story" | "building" | "reasoning" | "creative";

export type World = {
  id: string;
  name: string;
  category: WorldCategory;
  categoryName: string;
  description: string;
  symbol: string;
  host: string;
};

export const worlds: World[] = [
  { id: "official-center-town", name: "晨雾镇", category: "social", categoryName: "公共社交", description: "在晨雾河畔定居、工作、认识真实居民，并共同改变小镇。", symbol: "⌂", host: "晨雾镇导演" },
  { id: "official-adventurers-guild", name: "风口集", category: "story", categoryName: "任务冒险", description: "在商道与群山之间护送、寻人、探路，让走通过的路成为后来者的地图。", symbol: "⚑", host: "风口集导演" },
  { id: "official-city-detective-agency", name: "钟楼巷 19 号", category: "reasoning", categoryName: "悬疑推理", description: "从街坊小案开始，以固定真相和可复核证据逐步打开城市紧闭的门。", symbol: "?", host: "北桥调查导演" },
  { id: "official-apocalypse-shelter", name: "白河电站", category: "building", categoryName: "生存经营", description: "八个人守一座山中老电站，在煤、机器、班次和山下需要之间过完四季。", symbol: "△", host: "白河守站导演" },
  { id: "official-liminal-backrooms", name: "失序回廊", category: "story", categoryName: "异常探索", description: "沿刻字和录音探索原创错位空间，把可靠发现留进共同档案。", symbol: "▥", host: "回廊异常导演" },
];

export const worldTypes = new Set<WorldCategory | "create">([
  "social", "growth", "story", "building", "reasoning", "creative", "create",
]);
