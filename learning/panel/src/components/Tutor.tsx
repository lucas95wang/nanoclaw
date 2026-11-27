import { useState } from 'react';

import { api } from '../api';
import { STAGE_BY_N } from '../stages';
import { useStore } from '../store';

interface Turn {
  q: string;
  a: string;
  err?: boolean;
  ms?: number;
}

export function Tutor() {
  const { s, current, visible, reloadProfile } = useStore();
  const [q, setQ] = useState('');
  const [log, setLog] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const stageN = s.selectedStage ?? (visible.length ? Math.max(...visible.filter((e) => e.stage > 0).map((e) => e.stage), 0) : 0);
  const stage = STAGE_BY_N.get(stageN);
  const cli = s.snapshot?.claudeCli;

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setQ('');
    setBusy(true);
    try {
      const res = await api.tutor({
        question,
        mode: 'tutor',
        stageId: stage ? `s${stage.n}` : undefined,
        stageTitle: stage?.title,
        feature: stage?.feature,
        trace: current ? current.events : [],
        msgId: current?.msgId,
      });
      setLog((l) => [...l, { q: question, a: res.ok ? (res.answer ?? '') : `导师不可用：${res.reason ?? res.error}`, err: !res.ok, ms: res.ms }]);
      if (res.ok && stage) {
        try {
          await api.profileUpdate({ question: { id: `s${stage.n}`, topic: question.slice(0, 40) } });
          await reloadProfile();
        } catch {
          /* best-effort */
        }
      }
    } catch (e) {
      setLog((l) => [...l, { q: question, a: `请求失败：${String(e)}`, err: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tutor" id="tutor">
      <div className="h3" style={{ margin: 0 }}>
        导师 {stage ? `· 关于 ${stage.n} ${stage.title}` : ''}{' '}
        {cli && !cli.loggedIn && <span className="errc" style={{ textTransform: 'none', letterSpacing: 0 }}>· 本机 claude CLI 未登录（{cli.detail}）</span>}
      </div>
      <div className="log">
        {log.length === 0 && <div className="dim">问一个关于当前环节的问题。回答会引用右上这条消息的真实数据（时间、id、容器名）。</div>}
        {log.map((t, i) => (
          <div key={i}>
            <div className="q">{t.q}</div>
            <div className={`a ${t.err ? 'err' : ''}`}>{t.a}{t.ms ? <span className="dim"> · {(t.ms / 1000).toFixed(1)} s</span> : null}</div>
          </div>
        ))}
        {busy && <div className="a dim">导师在读 trace…</div>}
      </div>
      <form
        className="input"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input id="tutor-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={stage ? `问导师一个关于 ${stage.n} 的问题…` : '先选一个环节，再问导师…'} disabled={busy} />
        <button className="btn" type="submit" disabled={busy || !q.trim()} id="tutor-ask">问</button>
      </form>
    </div>
  );
}
