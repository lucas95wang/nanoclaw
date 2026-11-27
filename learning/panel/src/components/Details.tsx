import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import { GUESS_BY_STAGE, STAGE_BY_N, fmtClock, fmtMs } from '../stages';
import { useStore } from '../store';
import type { TraceEvent } from '../types';
import { Anatomy } from './Anatomy';

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 1).replace(/\n\s*/g, (m) => (m.length > 2 ? '\n' + ' '.repeat(Math.min(6, m.length - 1)) : m));
  } catch {
    return String(v);
  }
}

export function Details() {
  const { s, dispatch, current, visible, pendingStage, pendingReady, revealNext, reloadProfile } = useStore();
  const [featureMd, setFeatureMd] = useState<string>('');
  const [guess, setGuess] = useState<string | null>(null);

  // Which stage to describe: an explicit selection, else the pending one in step mode, else the latest visible.
  const stageN = s.selectedStage ?? (pendingStage ? pendingStage - 1 : undefined) ?? (visible.length ? Math.max(...visible.filter((e) => e.stage > 0).map((e) => e.stage), 0) : 0);
  const stage = STAGE_BY_N.get(stageN);
  const stageEvents = useMemo(() => visible.filter((e) => e.stage === stageN), [visible, stageN]);

  useEffect(() => {
    if (!stage) return;
    api.feature(stage.feature).then(setFeatureMd).catch(() => setFeatureMd(''));
  }, [stage?.feature]);

  useEffect(() => setGuess(null), [pendingStage, s.currentMsgId]);

  const q = pendingStage ? GUESS_BY_STAGE.get(pendingStage) : undefined;
  const realStageEvents = pendingStage && current ? current.events.filter((e) => e.stage === pendingStage) : [];

  const submitGuess = async (skip = false) => {
    if (!pendingStage || !current) return;
    const question = GUESS_BY_STAGE.get(pendingStage);
    if (!question) {
      revealNext();
      return;
    }
    const answer = question.answer(realStageEvents, current.events);
    const correct = skip || !guess ? null : answer === null ? null : guess === answer;
    const explain = question.explain(realStageEvents);
    dispatch({ type: 'reveal', revealed: pendingStage, last: { stage: pendingStage, guessed: guess ?? '（跳过）', answer, correct, explain }, skipped: skip });
    if (!skip && guess && answer !== null) {
      const id = `s${pendingStage}`;
      try {
        await api.profileUpdate({
          guess: { id, guessed: question.options.find((o) => o.key === guess)?.text ?? guess, actual: question.options.find((o) => o.key === answer)?.text ?? answer, correct: guess === answer, misconception: guess === answer ? undefined : '按面板里的真实数据对比后再看一遍这一环节' },
        });
        await reloadProfile();
      } catch {
        /* profile write is best-effort for the UI */
      }
    }
  };

  const html = useMemo(() => (featureMd ? DOMPurify.sanitize(marked.parse(featureMd) as string) : ''), [featureMd]);

  return (
    <>
      <div className="sect" id="next-step">
        <h3>{pendingStage ? '下一步 · 猜一猜' : s.mode === 'replay' && current ? '回放' : '下一步'}</h3>
        {!current && (
          <div className="card hi">
            <div><b>第一步：</b>点左下角的 <b>普通聊天</b>。这条消息会真的交给 NanoClaw，左边 8 个格子按真实顺序变绿。</div>
            <div style={{ marginTop: 6 }}><b>第二步：</b>点任意一个格子，这里显示它那一刻的真实数据、它做什么、为什么需要它。</div>
            <div style={{ marginTop: 6 }}><b>第三步：</b>顶栏切到 <b>单步</b>，再发一条，每步先猜再看答案。</div>
            <div className="muted" style={{ marginTop: 6 }}>不清楚这个面板是什么：点顶栏的"说明"。</div>
          </div>
        )}
        {current && pendingStage && q && (
          <div className="card hi">
            <div className="muted" style={{ marginBottom: 6 }}>{pendingReady ? `第 ${pendingStage} 步已经真实发生，先猜：` : `等第 ${pendingStage} 步真实发生…（它正在跑）`}</div>
            <div>{q.question}</div>
            {q.options.map((o) => (
              <button key={o.key} className={`opt ${guess === o.key ? 'sel' : ''}`} onClick={() => setGuess(o.key)} id={`guess-${pendingStage}-${o.key}`}>
                <i /> <span>{o.text}</span>
              </button>
            ))}
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn pri" disabled={!guess || !pendingReady} onClick={() => submitGuess(false)} id="guess-submit">提交我的猜测</button>
              <button className="btn" disabled={!pendingReady} onClick={() => submitGuess(true)} id="guess-skip">直接看真实结果</button>
            </div>
          </div>
        )}
        {current && pendingStage && !q && (
          <div className="card hi">
            <div>第 {pendingStage} 步 {STAGE_BY_N.get(pendingStage)?.title}</div>
            <button className="btn pri" style={{ marginTop: 8 }} disabled={!pendingReady} onClick={() => revealNext()} id="reveal-next">揭示这一步</button>
          </div>
        )}
        {current && s.step.last && s.mode !== 'live' && (
          <div className={`card ${s.step.last.correct === true ? 'ok' : s.step.last.correct === false ? 'bad' : ''}`} id="guess-result" style={{ marginTop: 8 }}>
            <div>
              第 {s.step.last.stage} 步：
              {s.step.last.correct === true ? <span className="okc">猜对了</span> : s.step.last.correct === false ? <span className="errc">猜错了</span> : <span className="muted">没有判定（跳过，或这条消息里没有这一步的数据）</span>}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>真实情况：{s.step.last.explain}</div>
            {s.step.last.correct === false && <div className="dim" style={{ marginTop: 4 }}>已记进档案，两天后回考。</div>}
          </div>
        )}
        {current && !pendingStage && s.mode !== 'live' && s.step.revealed >= 8 && <div className="card"><span className="okc">这条消息 8 步都揭示完了。</span> 换一条示例再来，或点底部"考核"。</div>}
        {current && s.mode === 'live' && !pendingStage && (
          <div className="muted">实时模式：点流程图上的任意环节看它这一刻的数据。要边猜边看，切到"单步"再发一条。</div>
        )}
      </div>

      <div className="sect scroll" id="stage-details">
        {stage ? (
          <>
            <h3>环节详情 · {stage.n} {stage.title} · 这一刻的真实数据</h3>
            {stage.n === 1 && s.snapshot && (
              <div className="dim" style={{ marginBottom: 6 }}>本机可观察的渠道：{s.snapshot.channels.map((c) => c.name).join('、')}。{s.snapshot.unavailable.whatsapp}</div>
            )}
            {stageEvents.length === 0 && <div className="muted">这条消息里还没有第 {stage.n} 步的数据{s.mode !== 'live' ? '（可能还没揭示）' : ''}。</div>}
            {stageEvents.length === 0 && stage.side === 'container' && current && current.events.some((e) => e.event === 'wake:already-running') && current.events.some((e) => e.event === 'deliver:done') && (
              <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 8 }}>
                <div>这一步真实发生了，但面板没有它的数据。</div>
                <div className="muted" style={{ marginTop: 4 }}>原因：回答这条消息的容器是在学习模式启动之前起来的（热容器），它没有被打开 trace 开关。让它被回收后再试：在 VM 里跑 <code>ncl groups restart --id {String(current.events.find((e) => e.agentGroupId)?.agentGroupId ?? '<agent group id>')}</code>，或等 30 分钟空闲后 sweep 自动回收。</div>
              </div>
            )}
            {stageEvents.map((e: TraceEvent) => (
              <details key={`${e.seq}-${e.tMs}`} open={stageEvents.length <= 3} className="evt" style={{ display: 'block', marginBottom: 6 }}>
                <summary>
                  <b>{e.event}</b> <span className="dim">{fmtClock(e.tMs)}{current ? ` · +${fmtMs(e.tMs - current.startedMs)}` : ''} · {e.side}</span>
                </summary>
                <div className="kv" style={{ marginTop: 4 }}>
                  <span className="k">文件:函数</span><span className="v" style={{ color: 'var(--accent)' }}>{e.file} › {e.fn}</span>
                  {Object.entries(e.data).map(([k, v]) => (
                    <span key={k} style={{ display: 'contents' }}>
                      <span className="k">{k}</span>
                      <span className="v">{typeof v === 'object' && v !== null ? pretty(v) : String(v)}</span>
                    </span>
                  ))}
                </div>
              </details>
            ))}
            <div className="card" style={{ marginTop: 8 }}>
              <div><b>做什么</b> <span className="muted">{stage.what}</span></div>
              <div style={{ marginTop: 4 }}><b>为什么需要它</b> <span className="muted">{stage.why}</span></div>
              <div className="mono" style={{ marginTop: 4, color: 'var(--accent)' }}>{stage.file} › {stage.fn}</div>
            </div>
            {(stage.n === 3 || stage.n === 7 || stage.n === 5 || stage.n === 8) && <Anatomy kind="mailbox" />}
            {(stage.n === 4 || stage.n === 6) && <Anatomy kind="sweep" />}
            <details style={{ marginTop: 8 }} open={false} id="feature-map">
              <summary>feature map · references/features/{stage.feature}</summary>
              <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
            </details>
          </>
        ) : (
          <div className="muted">点流程图上的环节，这里显示它的真实数据、作用和 feature map。</div>
        )}
      </div>
    </>
  );
}
