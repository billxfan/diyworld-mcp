import type { Metadata } from "next";
import "../globals.css";

const title = "diyworld — 进入一个会记住你的世界";
const description = "从你正在用的 AI Agent 进入。你的行动会被真人遇见、接续、改变。";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.diyworld.ai"),
  title,
  description,
  alternates: {
    canonical: "/",
    languages: { "zh-CN": "/", en: "/en" },
  },
  openGraph: {
    title,
    description,
    url: "/",
    type: "website",
    locale: "zh_CN",
    alternateLocale: ["en_US"],
    siteName: "diyworld",
  },
  twitter: { card: "summary", title, description },
};

export default function ChineseLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
