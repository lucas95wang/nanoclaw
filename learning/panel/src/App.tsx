import { useEffect, useMemo, useState } from 'react';

import { Chat } from './components/Chat';
import { Details } from './components/Details';
import { FlowGraph } from './components/FlowGraph';
import { KnowledgeMap } from './components/KnowledgeMap';
import { Quiz } from './components/Quiz';
import { Timeline } from './components/Timeline';
import { Tutor } from './components/Tutor';
import { Welcome } from './components/Welcome';
import { api } from './api';
import { STAGE_BY_N, isFinished, reachedStage } from './stages';
import { useStore } from './store';
import type { Mode, TraceListItem } from './types';

export function App() {
  const { s, dispatch, current, pendingStage, loadTrace } = useStore();
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [showReplay, setShowReplay] = useState(false);

  // First visit: the welcome overlay explains where to start and what the profile suggests.
  useEffect(() => {
    if (s.profile && s.overlay === 'none' && !sessionStorage.getItem('nc-welcomed')) dispatch({ type: 'overlay', value: 'welcome' });
  }, [s.profile, s.overlay, dispatch]);

  useEffect(() => {
    document.documentElement.classList.toggle('rm', s.reducedMotion);
  }, [s.reducedMotion]);

  useEffect(() => {
    if (showReplay) api.traces().then(setTraces).catch(() => setTraces([]));
  }, [showReplay]);

  const mastered = useMemo(() => s.profile?.mastery.filter((m) => m.level === '理解' || m.level === '能讲给别人听').length ?? 0, [s.profile]);
  const total = s.profile?.mastery.length ?? 0;

  const reached = current ? reachedStage(current.events) : 0;
  const finished = current ? isFinished(current.events) : false;
  const curStage = s.mode === 'live' ? reached : Math.min(s.step.revealed, reached);
  const statusText = !current
    ? '空闲'
    : s.mode === 'step' && pendingStage
      ? `暂停在 ${pendingStage - 1 >= 1 ? `${STAGE_BY_N.get(pendingStage - 1)!.n}` : ''} → 等你猜 ${pendingStage}`
      : finished
        ? `完成 · 到 ⑧`
        : `流转中 · ${curStage ? `${curStage} ${STAGE_BY_N.get(curStage)?.title}` : '等待第一个事件'}`;

  const setMode = (m: Mode) => {
    dispatch({ type: 'mode', value: m });
    if (m === 'replay') setShowReplay(true);
    else setShowReplay(false);
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <i className={s.connected ? '' : 'off'} />
          NanoClaw 学习面板
        </div>
        <div className="tabs" role="tablist" aria-label="模式">
          <button className={s.mode === 'live' ? 'on' : ''} onClick={() => setMode('live')} id="mode-live">实时</button>
          <button className={s.mode === 'step' ? 'on' : ''} onClick={() => setMode('step')} id="mode-step">单步</button>
          <button className={s.mode === 'replay' ? 'on' : ''} onClick={() => setMode('replay')} id="mode-replay">回放 ▾</button>
        </div>
        {showReplay && (
          <select
            id="replay-select"
            className="btn sm"
            value={s.mode === 'replay' ? (s.currentMsgId ?? '') : ''}
            onChange={(e) => e.target.value && loadTrace(e.target.value, 'replay')}
          >
            <option value="">选一条旧消息…</option>
            {traces.map((t) => (
              <option key={t.msgId} value={t.msgId}>
                {new Date(t.mtimeMs).toLocaleTimeString()} · {t.msgId} · {String((t.first?.data as { content?: { text?: string } } | undefined)?.content?.text ?? t.first?.data?.text ?? '').slice(0, 40)}
              </option>
            ))}
          </select>
        )}
        <div className="status">
          {current && <span>消息 <b>{current.msgId}</b></span>}
          <span id="status-text">状态：<b>{statusText}</b></span>
          <span>{s.snapshot ? `服务 ${s.snapshot.channels.map((c) => c.name).join('+')} · ${s.snapshot.sessions.filter((x) => x.containerStatus !== 'stopped').length} 个容器` : '连接中…'}</span>
          {s.faults.length > 0 && (s.drill.phase === 'broken' ? <span className="err">排障演练进行中 · 有一个环节被弄坏了</span> : <span className="err">故障开关：{s.faults.join(', ')}</span>)}
          <button className={`toggle ${s.reducedMotion ? 'on' : ''}`} onClick={() => dispatch({ type: 'reducedMotion', value: !s.reducedMotion })} id="reduced-motion">
            <i /> 减少动效
          </button>
        </div>
      </div>

      <div className="main">
        <div className="left">
          <div className="flowwrap">
            <Timeline />
            <FlowGraph />
          </div>
          <Chat />
        </div>
        <div className="right">
          <Details />
          <Tutor />
        </div>
      </div>

      <div className="foot">
        <button onClick={() => dispatch({ type: 'overlay', value: 'map' })} id="open-map">知识地图 · 已掌握 {mastered} / {total}</button>
        <div className="bar"><i style={{ width: total ? `${(mastered / total) * 100}%` : '0%' }} /></div>
        <button onClick={() => dispatch({ type: 'quiz', node: null })} id="open-quiz">考核 ›</button>
        <button onClick={() => dispatch({ type: 'overlay', value: 'welcome' })} id="open-welcome">进度与建议</button>
        <span className="dim">档案 learning/learner-profile.md</span>
        {s.error && <span className="errc">{s.error}</span>}
      </div>

      {s.overlay === 'map' && <KnowledgeMap />}
      {s.overlay === 'quiz' && <Quiz />}
      {s.overlay === 'welcome' && <Welcome />}
    </div>
  );
}
