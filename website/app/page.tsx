"use client";

import { FormEvent, useState } from "react";
import { worlds, type World } from "@/lib/worlds";
import { WorldUniverse } from "@/app/components/WorldUniverse";

type SubmitState = "idle" | "submitting" | "success" | "error";
type FormSource = "hero" | "access" | null;

export default function Home() {
  const [selection, setSelection] = useState(""); // world.id | "create" | ""（先不挑）
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
          locale: "zh",
        }),
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "提交失败，请稍后再试。");
      setSubmitState("success");
      setMessage(result.message ?? "已收到，我们会通过邮箱与你联系。");
    } catch (error) {
      setSubmitState("error");
      setMessage(error instanceof Error ? error.message : "提交失败，请稍后再试。");
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="diyworld 首页"><span className="brand-orbit" />diyworld</a>
        <nav aria-label="主要导航">
          <a href="#how">怎么玩</a>
          <a href="#worlds">世界</a>
          <a className="nav-cta" href="#early-access">申请体验</a>
        </nav>
      </header>

      {/* ① 首屏：定位 + 邮箱（转化前置） + 终端演示 */}
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker">不下载新应用 · 你的 Agent 就是入口</p>
          <h1><span>在你的 AI 助手里，</span><em>和真人共享一个世界。</em></h1>
          <p className="hero-lede">说一句话，结果会被其他真人遇见。</p>

          {source === "hero" && submitState === "success" ? (
            <p className="hero-form-success" role="status">{message}</p>
          ) : (
            <form className="hero-form" onSubmit={(event) => submit(event, "hero")}>
              <input name="email" type="email" required maxLength={160} autoComplete="email" placeholder="you@example.com" aria-label="邮箱" disabled={submitState === "submitting"} />
              <button type="submit" disabled={submitState === "submitting"}>{submitState === "submitting" ? "正在提交…" : "申请抢先体验 →"}</button>
              {source === "hero" && submitState === "error" ? <p className="hero-form-error" role="status">{message}</p> : null}
            </form>
          )}

          <p className="hero-support">适用于 Codex、Claude Code、WorkBuddy 等你已经在使用的 Agent。</p>
        </div>
        <WorldUniverse />
      </section>

      {/* ② 机制：三步图解 */}
      <section className="how-section" id="how">
        <p className="eyebrow">它和单独跟 AI 聊天不一样</p>
        <h2>同一个世界，真实的人，持续发生。</h2>
        <div className="steps">
          <article><strong>01</strong><h3>你说一句话</h3><p>在会话里对世界说话，比如「把这段走廊标记在地图上」。</p></article>
          <article><strong>02</strong><h3>主持 Agent 按规则裁定</h3><p>每个世界的 AI 主持 Agent 听懂你的意思，判定这件事成不成立、怎么发生。</p></article>
          <article><strong>03</strong><h3>生效后写入世界</h3><p>裁定通过的行动成为世界事实：标记写进地图。后来的人能看到，能接续。</p></article>
        </div>
        <p className="async-note">不需要同时在线——你留下的会被其他真人遇见，他们的行动也会改变你下次回来时的一切。</p>
      </section>

      {/* ③ 世界：4 个主推世界 */}
      <section className="world-section" id="worlds">
        <div className="section-intro">
          <p className="eyebrow">从一个正在发生的世界开始</p>
          <h2>选一个地方，进去和大家一起行动。</h2>
          <p>每个世界都有自己的规则、场景和一位主持人。没有预设的主角——包括你。</p>
        </div>

        <div className="world-grid">
          {worlds.map((world) => (
            <article className={`world-card tone-${world.category}`} key={world.id}>
              <div className="world-visual"><span>{world.symbol}</span><small>{world.categoryName}</small></div>
              <div className="world-content">
                <h3>{world.name}</h3>
                <p>{world.description}</p>
                <p className="world-host"><span>主持</span>{world.host}</p>
                <button type="button" onClick={() => explore(world)} aria-label={`申请体验${world.name}`}>想去这里 <span>→</span></button>
              </div>
            </article>
          ))}
          {/* 第 6 格：更多世界 */}
          <article className="world-card world-card-more" onClick={() => document.querySelector("#more-worlds")?.scrollIntoView({ behavior: "smooth" })}>
            <div className="world-visual"><span>∞</span><small>更多方向</small></div>
            <div className="world-content">
              <h3>还有更多世界</h3>
              <p>生活社交 · 成长探索 · 故事冒险 · 经营建设 · 推理决策 · 创作表达——每个方向都有可加入的世界，你也可以从零创造一个。</p>
              <button type="button">查看全部 <span>→</span></button>
            </div>
          </article>
        </div>
        <p className="world-teaser">官方世界只是起点——你也可以创造自己的世界。</p>
      </section>

      {/* ④ 更多世界：6 大方向 */}
      <section className="more-section" id="more-worlds">
        <div className="section-intro">
          <p className="eyebrow">还能是什么</p>
          <h2>更多世界，可以是任何东西。</h2>
          <p>六个方向都有世界可加入——你也可以创造自己的，描述一个设定，AI 帮你生成可运行的世界定义，邀请其他玩家一起进入。</p>
        </div>
        <div className="more-grid">
          <article><h3>生活社交</h3><p>晨雾镇 · 合租公寓 · 海岛社区 · 旅行列车</p></article>
          <article><h3>成长探索</h3><p>魔法学院 · 怪物训练大陆 · 星际开拓队</p></article>
          <article><h3>故事冒险</h3><p>风口集 · 大航海世界 · 时空管理局 · 失序回廊</p></article>
          <article><h3>经营建设</h3><p>白河电站 · 火星殖民地 · 田园村庄 · 冒险者公会</p></article>
          <article><h3>推理决策</h3><p>钟楼巷 19 号 · 全城侦探事务所 · 未来城市议会</p></article>
          <article><h3>创作表达</h3><p>梦境博物馆 · 世界剧场</p></article>
        </div>
        <p className="more-footer">你也可以创造完全新的方向——不限于以上六类。</p>
      </section>

      {/* ⑤ 收口：二次邮箱 + Footer */}
      <section className="access-section" id="early-access">
        <div className="access-copy">
          <h2>想先进入哪个世界？</h2>
          <p>留下邮箱，开放时我们会按申请顺序发出邀请。</p>
        </div>
        <form className="access-form" onSubmit={(event) => submit(event, "access")}>
          {chosenWorld ? (
            <div className="selected-world"><span>你想探索的世界</span><strong>{chosenWorld.name}</strong><button type="button" onClick={() => setSelection("")}>更换</button></div>
          ) : null}
          <label>邮箱<input name="email" type="email" required maxLength={160} autoComplete="email" placeholder="you@example.com" /></label>
          <label>想先玩哪个世界？
            <select name="worldId" value={selection} onChange={(event) => setSelection(event.target.value)}>
              <option value="">先不挑，都可以</option>
              {worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
              <option value="create">创造自己的世界</option>
            </select>
          </label>
          <button className="submit-button" type="submit" disabled={submitState === "submitting"}>{submitState === "submitting" ? "正在提交…" : "提交申请 →"}</button>
          {source === "access" && message ? <p className={`form-message ${submitState}`} role="status">{message}</p> : null}
          <p className="form-note">提交即表示你同意我们仅将这些信息用于体验邀请和产品沟通。重复提交不会覆盖原有申请；请勿代他人提交邮箱。</p>
        </form>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-orbit" />diyworld</a>
        <p>在你的 Agent 里，和其他人共享世界。</p>
        <span>© 2026 diyworld · Beta</span>
      </footer>
    </main>
  );
}
