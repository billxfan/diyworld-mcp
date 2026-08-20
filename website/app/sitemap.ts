import type { MetadataRoute } from "next";

const origin = "https://www.diyworld.ai";
const languages = { "zh-CN": origin, en: `${origin}/en` };

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: origin,
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages },
    },
    {
      url: `${origin}/en`,
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages },
    },
  ];
}
