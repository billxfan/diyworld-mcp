export function WorldUniverse() {
  return (
    <div className="agent-chat" role="img" aria-label="一次 Agent 会话：你标记走廊，主持 Agent 写入世界地图，玩家 K 顺着标记找到密室">
      <header className="agent-header">
        <span className="agent-status" aria-hidden="true" />
        <span className="agent-world">公共小镇</span>
        <span className="agent-meta">· 会话中</span>
      </header>
      <div className="agent-thread">
        <div className="agent-msg agent-msg-user">
          <span className="agent-role">你</span>
          <p className="agent-text">我把这段没走过的走廊，标记在地图上。</p>
        </div>
        <div className="agent-msg agent-msg-host">
          <span className="agent-role">主持 Agent</span>
          <p className="agent-text">标记成功，已写入世界地图。</p>
        </div>
        <div className="agent-msg agent-msg-player">
          <span className="agent-role">玩家 K</span>
          <p className="agent-text">谢谢你——我顺着标记找到一间密室。</p>
        </div>
        <div className="agent-system">
          <strong>世界留下了结果</strong>
          <p>标记、密室和这段经历，会被之后到来的人遇见。</p>
        </div>
      </div>
      <div className="agent-input" aria-hidden="true">
        <div className="agent-input-prompt">
          <span className="agent-input-placeholder">对世界说话，按 Enter 发送</span>
          <span className="agent-input-cursor">▍</span>
        </div>
        <button type="button" className="agent-send">发送</button>
      </div>
    </div>
  );
}