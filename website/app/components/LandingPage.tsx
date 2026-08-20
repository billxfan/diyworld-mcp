"use client";

import { FormEvent, useState } from "react";
import { getWorlds, type World, type WorldLocale } from "@/lib/worlds";
import { WorldUniverse } from "@/app/components/WorldUniverse";

type SubmitState = "idle" | "submitting" | "success" | "error";
type FormSource = "hero" | "access" | null;

const copyByLocale = {
  zh: {
    brandLabel: "diyworld 首页",
    navLabel: "主要导航",
    navHow: "原理",
    navWorlds: "世界",
    navCta: "加入体验",
    navCtaShort: "申请",
    languageLabel: "Switch to English",
    languageText: "EN",
    languageHref: "/en",
    kicker: "你的 Agent，就是入口",
    heroLine1: "进入一个",
    heroLine2: "会记住你的世界。",
    lede: "你做的事，会被真人遇见、接续、改变。",
    emailLabel: "邮箱",
    submitHero: "加入体验 →",
    submitting: "正在提交…",
    submitError: "提交失败，请稍后再试。",
    submitSuccess: "已收到，我们会通过邮箱与你联系。",
    support: "不用下载。直接从 Codex、Claude Code 或 WorkBuddy 进入。",
    howEyebrow: "不是独角戏",
    howTitle: "你行动。主持裁定。世界记住。",
    steps: [
      ["说出行动", "像聊天一样，告诉世界你想做什么。"],
      ["按规则发生", "主持 Agent 根据事实与规则裁定结果。"],
      ["留给后来者", "结果写入世界，成为别人行动的起点。"],
    ],
    asyncNote: "不用同时在线。你离开后，故事仍由真人继续。",
    worldsEyebrow: "选择入口",
    worldsTitle: "挑一个世界，留下你的痕迹。",
    worldsIntro: "没有预设主角。每个人都能改变后来发生的事。",
    hostLabel: "主持",
    exploreLabel: "进入看看",
    applyAria: "申请体验",
    coverAlt: "封面插画",
    moreCardCategory: "从零创造",
    moreCardTitle: "没找到想去的？",
    moreCardDescription: "说出一个设定，AI 把它变成可运行、可邀请的世界。",
    viewAll: "创造世界",
    worldTeaser: "7 个官方世界已开放。你的可以是下一个。",
    accessTitle: "你想先去哪？",
    accessIntro: "留下邮箱。开放时，我们按顺序邀请。",
    selectedLabel: "你想探索的世界",
    change: "更换",
    worldQuestion: "先去哪个世界？",
    undecided: "先不挑，都可以",
    create: "创造自己的世界",
    submitAccess: "加入体验 →",
    formNote: "我们只用这些信息发送体验邀请。",
    footer: "和真人，共享一个会记住的世界。",
  },
  en: {
    brandLabel: "diyworld home",
    navLabel: "Primary navigation",
    navHow: "How",
    navWorlds: "Worlds",
    navCta: "Join beta",
    navCtaShort: "Join",
    languageLabel: "切换到中文",
    languageText: "中文",
    languageHref: "/",
    kicker: "Your AI agent is the doorway",
    heroLine1: "Enter a world",
    heroLine2: "that remembers.",
    lede: "What you do becomes someone else's next move.",
    emailLabel: "Email address",
    submitHero: "Join the beta →",
    submitting: "Submitting…",
    submitError: "We couldn't submit this right now. Please try again.",
    submitSuccess: "You're on the list. We'll reach out by email.",
    support: "No download. Enter through Codex, Claude Code, or WorkBuddy.",
    howEyebrow: "Not a solo AI chat",
    howTitle: "You act. The Host decides. The world remembers.",
    steps: [
      ["Say what you do", "Act in plain language, right inside your agent chat."],
      ["The Host decides", "An AI Host applies the world's facts and rules."],
      ["The world remembers", "The result becomes another person's starting point."],
    ],
    asyncNote: "No one has to be online together. The world keeps what matters.",
    worldsEyebrow: "Choose your doorway",
    worldsTitle: "Pick a world. Leave your mark.",
    worldsIntro: "No preset hero. Every person can change what happens next.",
    hostLabel: "HOST",
    exploreLabel: "Enter this world",
    applyAria: "Apply to explore ",
    coverAlt: "cover artwork",
    moreCardCategory: "BUILD YOUR OWN",
    moreCardTitle: "Can't find your world?",
    moreCardDescription: "Describe it. AI turns the idea into a playable world you can invite others into.",
    viewAll: "Create a world",
    worldTeaser: "Seven official worlds are open. Yours could be next.",
    accessTitle: "Where would you go first?",
    accessIntro: "Join the list. Invitations go out in order.",
    selectedLabel: "Your selected world",
    change: "Change",
    worldQuestion: "Pick a world",
    undecided: "No preference yet",
    create: "Create a world of my own",
    submitAccess: "Join the beta →",
    formNote: "We'll only use this information for your invitation.",
    footer: "Share a world that remembers—with real people.",
  },
} as const;

export function LandingPage({ locale }: { locale: WorldLocale }) {
  const copy = copyByLocale[locale];
  const worlds = getWorlds(locale);
  const [selection, setSelection] = useState("");
  const chosenWorld = worlds.find((world) => world.id === selection);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [source, setSource] = useState<FormSource>(null);

  function explore(world: World) {
    setSelection(world.id);
    setSubmitState("idle");
    setMessage("");
    document.querySelector("#early-access")?.scrollIntoView({ behavior: "smooth" });
  }

  function createWorld() {
    setSelection("create");
    setSubmitState("idle");
    setMessage("");
    document.querySelector("#early-access")?.scrollIntoView({ behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>, formSource: FormSource) {
    event.preventDefault();
    setSubmitState("submitting");
    setMessage("");
    setSource(formSource);
    const form = new FormData(event.currentTarget);
    const picked = String(form.get("worldId") ?? "").trim() || selection;
    const chosen = worlds.find((world) => world.id === picked);
    const worldType = chosen ? chosen.category : picked === "create" ? "create" : "undecided";

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          worldType,
          selectedWorldId: chosen?.id,
          locale,
        }),
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? copy.submitError);
      setSubmitState("success");
      setMessage(result.message ?? copy.submitSuccess);
    } catch (error) {
      setSubmitState("error");
      setMessage(error instanceof Error ? error.message : copy.submitError);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label={copy.brandLabel}><span className="brand-orbit" />diyworld</a>
        <nav aria-label={copy.navLabel}>
          <a href="#how">{copy.navHow}</a>
          <a href="#worlds">{copy.navWorlds}</a>
          <a className="language-switch" href={copy.languageHref} hrefLang={locale === "en" ? "zh-CN" : "en"} aria-label={copy.languageLabel}>{copy.languageText}</a>
          <a className="nav-cta" href="#early-access"><span className="nav-cta-long">{copy.navCta}</span><span className="nav-cta-short">{copy.navCtaShort}</span></a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker">{copy.kicker}</p>
          <h1><span>{copy.heroLine1}</span><em>{copy.heroLine2}</em></h1>
          <p className="hero-lede">{copy.lede}</p>

          {source === "hero" && submitState === "success" ? (
            <p className="hero-form-success" role="status">{message}</p>
          ) : (
            <form className="hero-form" onSubmit={(event) => submit(event, "hero")}>
              <input name="email" type="email" required maxLength={160} autoComplete="email" placeholder="you@example.com" aria-label={copy.emailLabel} disabled={submitState === "submitting"} />
              <button type="submit" disabled={submitState === "submitting"}>{submitState === "submitting" ? copy.submitting : copy.submitHero}</button>
              {source === "hero" && submitState === "error" ? <p className="hero-form-error" role="status">{message}</p> : null}
            </form>
          )}

          <p className="hero-support">{copy.support}</p>
        </div>
        <WorldUniverse locale={locale} />
      </section>

      <section className="how-section" id="how">
        <p className="eyebrow">{copy.howEyebrow}</p>
        <h2>{copy.howTitle}</h2>
        <div className="steps">
          {copy.steps.map(([title, description], index) => (
            <article key={title}><strong>{String(index + 1).padStart(2, "0")}</strong><h3>{title}</h3><p>{description}</p></article>
          ))}
        </div>
        <p className="async-note">{copy.asyncNote}</p>
      </section>

      <section className="world-section" id="worlds">
        <div className="section-intro">
          <p className="eyebrow">{copy.worldsEyebrow}</p>
          <h2>{copy.worldsTitle}</h2>
          <p>{copy.worldsIntro}</p>
        </div>

        <div className="world-grid">
          {worlds.map((world) => (
            <article className={`world-card tone-${world.category}`} key={world.id}>
              <div className="world-visual"><img src={world.coverImage} alt={`${world.name} ${copy.coverAlt}`} loading="lazy" /><small>{world.categoryName}</small></div>
              <div className="world-content">
                <h3>{world.name}</h3>
                <p>{world.description}</p>
                <p className="world-host"><span>{copy.hostLabel}</span>{world.host}</p>
                <button type="button" onClick={() => explore(world)} aria-label={`${copy.applyAria}${world.name}`}>{copy.exploreLabel} <span>→</span></button>
              </div>
            </article>
          ))}
          <article className="world-card world-card-more" onClick={createWorld}>
            <div className="world-visual"><span>∞</span><small>{copy.moreCardCategory}</small></div>
            <div className="world-content">
              <h3>{copy.moreCardTitle}</h3>
              <p>{copy.moreCardDescription}</p>
              <button type="button">{copy.viewAll} <span>→</span></button>
            </div>
          </article>
        </div>
        <p className="world-teaser">{copy.worldTeaser}</p>
      </section>

      <section className="access-section" id="early-access">
        <div className="access-copy">
          <h2>{copy.accessTitle}</h2>
          <p>{copy.accessIntro}</p>
        </div>
        <form className="access-form" onSubmit={(event) => submit(event, "access")}>
          {chosenWorld ? (
            <div className="selected-world"><span>{copy.selectedLabel}</span><strong>{chosenWorld.name}</strong><button type="button" onClick={() => setSelection("")}>{copy.change}</button></div>
          ) : null}
          <label>{copy.emailLabel}<input name="email" type="email" required maxLength={160} autoComplete="email" placeholder="you@example.com" /></label>
          <label>{copy.worldQuestion}
            <select name="worldId" value={selection} onChange={(event) => setSelection(event.target.value)}>
              <option value="">{copy.undecided}</option>
              {worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
              <option value="create">{copy.create}</option>
            </select>
          </label>
          <button className="submit-button" type="submit" disabled={submitState === "submitting"}>{submitState === "submitting" ? copy.submitting : copy.submitAccess}</button>
          {source === "access" && message ? <p className={`form-message ${submitState}`} role="status">{message}</p> : null}
          <p className="form-note">{copy.formNote}</p>
        </form>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-orbit" />diyworld</a>
        <p>{copy.footer}</p>
        <span>© 2026 diyworld · Beta</span>
      </footer>
    </main>
  );
}
