import type { Metadata } from "next";
import "../globals.css";

const title = "diyworld — Enter a world that remembers";
const description = "Act through your AI agent. Real people discover what changes—and continue from there.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.diyworld.ai"),
  title,
  description,
  alternates: {
    canonical: "/en",
    languages: { "zh-CN": "/", en: "/en" },
  },
  openGraph: {
    title,
    description,
    url: "/en",
    type: "website",
    locale: "en_US",
    alternateLocale: ["zh_CN"],
    siteName: "diyworld",
  },
  twitter: { card: "summary", title, description },
};

export default function EnglishLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
