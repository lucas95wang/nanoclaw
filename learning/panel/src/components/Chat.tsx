import { useEffect, useRef, useState } from 'react';

import { SAMPLES, isFinished, reachedStage } from '../stages';
import { useStore } from '../store';

export function Chat() {
  const { s, send, current, dispatch } = useStore();
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [s.order.length, current?.replies.length, current?.events.length]);

  const submit = async (t: string) => {
    const v = t.trim();
    if (!v || s.sending) return;
    setText('');
    if (s.mode === 'replay') dispatch({ type: 'mode', value: 'live' });
    await send(v);
  };

  const recent = s.order.slice(-6).map((id) => s.messages[id]);

  return (
    <div className="chat zone-chat" id="chat">
      <div className="zone-head">
        <span className="zone-title"><i className="avatar">N</i>和真实的 NanoClaw 对话</span>
        <span className="zone-sub">你发的消息真的交给 NanoClaw 处理；Nano 的回复经 ⑧ 送回这里。上面的流程图是这条消息在它内部走过的路。</span>
      </div>
      <div className="chips">
        {SAMPLES.map((x) => (
          <button key={x.label} className="chip" title={`${x.text}\n路径：${x.path}`} onClick={() => submit(x.text)} disabled={s.sending} id={`sample-${x.label}`}>
            {x.label}
          </button>
        ))}
        <span className="dim" style={{ alignSelf: 'center' }}>示例消息走和终端一样的入口 ①</span>
      </div>
      <div className="msgs" ref={logRef}>
        {recent.length === 0 && <div className="msg"><div className="who" /><div className="body wait">还没有消息。点一个示例，或在下面输入。</div></div>}
        {recent.map((m) => {
          const isCur = m.msgId === s.currentMsgId;
          const reached = reachedStage(m.events);
          const fin = isFinished(m.events);
          return (
            <div key={m.msgId} style={{ display: 'contents' }}>
              <div className={`msg me ${isCur ? 'cur' : ''}`} onClick={() => dispatch({ type: 'current', msgId: m.msgId })} style={{ cursor: 'pointer' }}>
                <div className="body">{m.text || <span className="muted">{m.msgId}</span>}</div>
                <div className="who">{m.source === 'panel' ? '你' : m.source === 'replay' ? '回放' : '终端'}</div>
              </div>
              {(() => {
                // In step mode the reply is a spoiler until stage 8 is revealed.
                const hidden = isCur && s.mode !== 'live' && s.step.revealed < 8;
                return !hidden
                  ? m.replies.map((r) => (
                      <div className="msg" key={r.id}>
                        <div className="who"><i className="avatar">N</i>Nano</div>
                        <div className={`body ${r.kind !== 'chat' ? 'sys' : ''}`}>{r.text ?? JSON.stringify(r.content)}</div>
                      </div>
                    ))
                  : null;
              })()}
              {(m.replies.length === 0 || (isCur && s.mode !== 'live' && s.step.revealed < 8)) && (
                <div className="msg">
                  <div className="who"><i className="avatar">N</i>Nano</div>
                  <div className="body wait">
                    {fin && m.events.some((e) => e.event === 'route:dropped')
                      ? '这条消息在 ② 被丢弃，不会有回复。点 ② 看原因。'
                      : fin
                        ? '已投递（回复经真实渠道送出，面板没有收到副本）'
                        : s.mode === 'step' && isCur
                          ? `单步模式：真实流程已经跑到 ${reached ? `第 ${reached} 步` : '入口'}，面板按你的猜测逐步揭示。`
                          : reached
                            ? `处理中 · 已到第 ${reached} 步…`
                            : '等待进入系统…'}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form
        className="input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="发消息给 Nano…（进入 ① 渠道接收，和终端渠道同一入口）" disabled={!s.snapshot?.panelChannelReady} />
        <button className="btn pri" type="submit" disabled={s.sending || !text.trim()} id="chat-send">发送</button>
      </form>
    </div>
  );
}
