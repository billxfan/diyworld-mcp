import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "diyworld — 在你的 AI 助手里，和真人共享一个世界",
  description: "不用下载新应用。在你的 Codex、Claude Code 或 WorkBuddy 里说一句话，进入一个和真实玩家共享、持续存在的世界。",
  openGraph: {
    title: "diyworld — 在你的 AI 助手里，和真人共享一个世界",
    description: "不用下载新应用。在你的 Codex、Claude Code 或 WorkBuddy 里说一句话，进入一个和真实玩家共享、持续存在的世界。",
    type: "website",
    locale: "zh_CN",
    siteName: "diyworld",
  },
  twitter: {
    card: "summary",
    title: "diyworld — 在你的 AI 助手里，和真人共享一个世界",
    description: "不用下载新应用。在你的 Codex、Claude Code 或 WorkBuddy 里说一句话，进入一个和真实玩家共享、持续存在的世界。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
