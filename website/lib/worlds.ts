export type WorldCategory = "social" | "growth" | "story" | "building" | "reasoning" | "creative";
export type WorldLocale = "zh" | "en";

export type World = {
  id: string;
  name: string;
  category: WorldCategory;
  categoryName: string;
  description: string;
  symbol: string;
  host: string;
  coverImage: string;
};

type WorldCopy = Pick<World, "name" | "categoryName" | "description" | "host">;
type WorldRecord = Omit<World, keyof WorldCopy> & { copy: Record<WorldLocale, WorldCopy> };

const worldRecords: WorldRecord[] = [
  {
    id: "official-center-town", category: "social", symbol: "⌂", coverImage: "/world-covers/morning-mist-town.png",
    copy: {
      zh: { name: "晨雾镇", categoryName: "公共社交", description: "住进河畔小镇。认识邻居，改变日常。", host: "晨雾镇导演" },
      en: { name: "Morning Mist Town", categoryName: "Social life", description: "Settle by the river. Meet neighbors. Change the town.", host: "Town Steward" },
    },
  },
  {
    id: "official-adventurers-guild", category: "story", symbol: "⚑", coverImage: "/world-covers/wind-gate-market.png",
    copy: {
      zh: { name: "风口集", categoryName: "任务冒险", description: "接下山野委托。把走通的路留给后来者。", host: "风口集导演" },
      en: { name: "Windgate Market", categoryName: "Quest adventure", description: "Take mountain jobs. Leave safer routes behind.", host: "Windgate Director" },
    },
  },
  {
    id: "official-city-detective-agency", category: "reasoning", symbol: "?", coverImage: "/world-covers/clocktower-lane-19.png",
    copy: {
      zh: { name: "钟楼巷 19 号", categoryName: "悬疑推理", description: "调查街坊小案。用可复核的证据逼近真相。", host: "北桥调查导演" },
      en: { name: "19 Clocktower Lane", categoryName: "Urban mystery", description: "Solve small cases with evidence others can verify.", host: "Northbridge Case Director" },
    },
  },
  {
    id: "official-apocalypse-shelter", category: "building", symbol: "△", coverImage: "/world-covers/white-river-power-station.png",
    copy: {
      zh: { name: "白河电站", categoryName: "生存经营", description: "守住山中电站，让灯光熬过漫长冬天。", host: "白河守站导演" },
      en: { name: "White River Power Station", categoryName: "Survival management", description: "Keep a mountain power station alive through winter.", host: "Station Steward" },
    },
  },
  {
    id: "official-liminal-backrooms", category: "story", symbol: "▥", coverImage: "/world-covers/disordered-corridor.png",
    copy: {
      zh: { name: "失序回廊", categoryName: "异常探索", description: "探索错位空间。为后来者画出可靠的路。", host: "回廊异常导演" },
      en: { name: "The Disordered Corridor", categoryName: "Anomaly exploration", description: "Map an impossible space for whoever follows.", host: "Corridor Director" },
    },
  },
  {
    id: "official-maple-hollow", category: "social", symbol: "⌂", coverImage: "/world-covers/maple-hollow.png",
    copy: {
      zh: { name: "Maple Hollow", categoryName: "温馨社交", description: "守一个承诺，留一点痕迹，慢慢成为邻居。", host: "Maple Hollow Steward" },
      en: { name: "Maple Hollow", categoryName: "Cozy social", description: "Keep a promise. Leave a trace. Find your place.", host: "Maple Hollow Steward" },
    },
  },
  {
    id: "official-bellwether-investigations", category: "reasoning", symbol: "?", coverImage: "/world-covers/bellwether-investigations.png",
    copy: {
      zh: { name: "Bellwether Investigations", categoryName: "协作推理", description: "让证据支撑结论，把案件交给下一位调查员。", host: "Bellwether Case Steward" },
      en: { name: "Bellwether Investigations", categoryName: "Cooperative mystery", description: "Build every claim on evidence. Hand the case forward.", host: "Bellwether Case Steward" },
    },
  },
];

export function getWorlds(locale: WorldLocale): World[] {
  return worldRecords.map(({ copy, ...world }) => ({ ...world, ...copy[locale] }));
}

// The API keeps this Chinese default for backward compatibility. Localized
// application submissions resolve their display name with getWorlds(locale).
export const worlds = getWorlds("zh");

export const worldTypes = new Set<WorldCategory | "create">([
  "social", "growth", "story", "building", "reasoning", "creative", "create",
]);
