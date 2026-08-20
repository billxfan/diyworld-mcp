import type { WorldLocale } from "@/lib/worlds";

const copy = {
  zh: {
    aria: "晨雾镇中，你向主持 Agent 提议修好旧车站的排水沟，三天后另一位玩家沿着公告板箭头找到一封信",
    world: "晨雾镇",
    meta: "· 持续发生",
    you: "你",
    user: "清理旧车站的排水沟，再标出安全入口。",
    host: "主持 Agent",
    hostMessage: "完成。排水沟和标记已写入晨雾镇。",
    later: "三天后",
    player: "后来来的玩家",
    playerMessage: "我沿着你的标记走到车站，还发现了一封被雨水泡过的信。",
    result: "世界留下了结果",
    resultMessage: "你的行动，成了另一个人的开始。",
    placeholder: "对世界说话，按 Enter 发送",
    send: "发送",
  },
  en: {
    aria: "In Maple Hollow, you ask the Host agent to clear the old passenger depot drain; three days later another player follows your notice and discovers a rain-soaked letter",
    world: "Maple Hollow",
    meta: "· persistent world",
    you: "You",
    user: "Clear the depot drain and mark the safe entrance.",
    host: "Host agent",
    hostMessage: "Done. The drain and notice are now part of Maple Hollow.",
    later: "Three days later",
    player: "Another player",
    playerMessage: "I followed your mark—and found a rain-soaked letter.",
    result: "The world remembered",
    resultMessage: "Your action became someone else's beginning.",
    placeholder: "Speak to the world, then press Enter",
    send: "Send",
  },
} satisfies Record<WorldLocale, Record<string, string>>;

export function WorldUniverse({ locale }: { locale: WorldLocale }) {
  const text = copy[locale];

  return (
    <div className="agent-chat" role="img" aria-label={text.aria}>
      <header className="agent-header">
        <span className="agent-status" aria-hidden="true" />
        <span className="agent-world">{text.world}</span>
        <span className="agent-meta">{text.meta}</span>
      </header>
      <div className="agent-thread">
        <div className="agent-msg agent-msg-user">
          <span className="agent-role">{text.you}</span>
          <p className="agent-text">{text.user}</p>
        </div>
        <div className="agent-msg agent-msg-host">
          <span className="agent-role">{text.host}</span>
          <p className="agent-text">{text.hostMessage}</p>
        </div>
        <div className="agent-time" aria-hidden="true">{text.later}</div>
        <div className="agent-msg agent-msg-player">
          <span className="agent-role">{text.player}</span>
          <p className="agent-text">{text.playerMessage}</p>
        </div>
        <div className="agent-system">
          <strong>{text.result}</strong>
          <p>{text.resultMessage}</p>
        </div>
      </div>
      <div className="agent-input" aria-hidden="true">
        <div className="agent-input-prompt">
          <span className="agent-input-placeholder">{text.placeholder}</span>
          <span className="agent-input-cursor">▍</span>
        </div>
        <button type="button" className="agent-send">{text.send}</button>
      </div>
    </div>
  );
}
