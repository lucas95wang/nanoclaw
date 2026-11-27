import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import { STAGES, isFinished } from '../stages';
import { useStore } from '../store';
import type { Level } from '../types';

interface Grade {
  score: number;
  pass: boolean;
  perPoint: Array<{ point: string; hit: boolean; comment: string }>;
  level?: Level;
  feedback: string;
}

function parseGrade(text: string): Grade | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const g = JSON.parse(m[0]) as Grade;
    if (typeof g.score !== 'number' || !Array.isArray(g.perPoint)) return null;
    return g;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ scenarios */

interface Scenario {
  id: string;
  nodes: string[];
  title: string;
  prompt: string;
  rubric: string[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'q1',
    nodes: ['s2', 'm-channels'],
    title: '接线被删了',
    prompt: '假设有人用 `ncl wirings delete` 删掉了面板渠道到 Nano 的接线，然后你在面板里再发一条消息。推理：这条消息会在哪一步停下？宿主日志和中央库里会留下什么？用户看到什么？',
    rubric: ['停在 ② 路由：messaging_group 还在但 agentCount=0', 'dropped_messages 里多一行 reason=no_agent_wired；日志 MESSAGE DROPPED', '没有 session、没有容器、没有回复；重新接线后新消息才正常'],
  },
  {
    id: 'q2',
    nodes: ['s6', 'm-gateway', 'm-sweep'],
    title: '网关在模型回合中挂了',
    prompt: '这条消息在第 ⑤ 步被容器认领、⑥ 收到 init 之后，OneCLI 网关容器挂了。推理：这条消息最终会怎样？用户在终端会看到什么？宿主日志里会出现哪几类记录？',
    rubric: ['网关健康监测（5 秒一次）失败后宿主停掉相关会话，不让容器干等', '被认领的消息被 resetStuckProcessingRows 改回 pending，按 5s×2ⁿ 退避重试，最多 5 次', '终端 120 秒没回复以退出码 3 结束；日志有 Gateway session became unavailable 和 marked as failed after max retries'],
  },
  {
    id: 'q3',
    nodes: ['s4', 'm-isolation', 'm-memory'],
    title: '改了人设为什么没生效',
    prompt: '你直接编辑了 groups/cli-with-lucas/CLAUDE.md 让 Nano 用中文回答，发消息后它还是英文。推理：为什么？正确的改法是什么？改完后哪一步会让它生效？',
    rubric: ['CLAUDE.md 是每次 spawn 由 composeGroupProjectDoc 重拼的，第一行写着 do not edit，改动会被覆盖', '应该改 instructions.prepend.md（人设）或 memory/', '下一次 ④ 唤醒容器（spawn）时重新拼进去才生效；热容器不会重读'],
  },
  {
    id: 'q4',
    nodes: ['s8', 'm-mailbox', 's1'],
    title: '两个宿主同时在跑',
    prompt: '有人在服务还在跑的时候又执行了 pnpm run dev。推理：发一条终端消息会发生什么？为什么"回复已投递"但用户看不到？怎么确认并修复？',
    rubric: ['两个进程读同一个 outbound.db，谁先轮询到谁投递，另一个把它标成已投递', 'cli.sock 被后起的进程抢走，回复可能从不持有客户端连接的那个进程发出，所以没人看到', '用 ps / systemctl 确认只留一个进程；被标为已投递的消息不会重试'],
  },
  {
    id: 'q5',
    nodes: ['m-tasks', 'm-sweep', 's7'],
    title: '定时任务为什么晚了一分钟',
    prompt: '你让 Nano 两分钟后提醒你，任务 process_after 是 14:10:00，实际 14:10:58 才跑。推理：为什么会晚？提醒的文字是怎么到你手里的（和普通回复有什么不同）？',
    rubric: ['任务到期由 60 秒一次的 host sweep 发现，最多晚约 60 秒', '任务会话的最终文字进运行日志 tasks/<series>.md，不投递', '要到聊天里必须 agent 调 send_message 写 messages_out'],
  },
];

const FAULT_OPTIONS = [
  { key: 'wake-refused', text: '④ 容器起不来：会话驱动拒绝启动（策略拒绝，sweep 每分钟重试）' },
  { key: 'route-denied', text: '② 路由把发送者拦住了：access gate 拒绝，消息被丢弃' },
  { key: 'gateway', text: '⑥ 网关 OneCLI 不可用' },
  { key: 'deliver', text: '⑧ 投递失败：渠道 adapter 不在线' },
];

export function Quiz() {
  const { s, dispatch, reloadProfile, current, send } = useStore();
  const tab = s.quizTab;
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [raw, setRaw] = useState<string>('');
  const [scenarioIdx, setScenarioIdx] = useState(0);
  // drill state
  const [drill, setDrill] = useState<{ fault: string | null; phase: 'idle' | 'broken' | 'diagnosed' | 'recovered'; pick: string | null; result: boolean | null; sentId: string | null; verifyId: string | null }>({ fault: null, phase: 'idle', pick: null, result: null, sentId: null, verifyId: null });

  const scenarios = useMemo(() => {
    if (!s.quizNode) return SCENARIOS;
    const first = SCENARIOS.filter((x) => x.nodes.includes(s.quizNode!));
    return [...first, ...SCENARIOS.filter((x) => !first.includes(x))];
  }, [s.quizNode]);
  const scenario = scenarios[scenarioIdx] ?? scenarios[0];

  useEffect(() => {
    setGrade(null);
    setRaw('');
    setAnswer('');
  }, [tab, scenarioIdx]);

  const cli = s.snapshot?.claudeCli;
  const tutorOk = !!cli?.loggedIn;

  const applyLevels = async (ids: string[], g: Grade, perStage?: boolean) => {
    const updates: Array<{ id: string; level: Level }> = [];
    if (perStage) {
      for (const p of g.perPoint) {
        const st = STAGES.find((x) => p.point.includes(x.title) || p.point.includes(String(x.n)));
        if (st) updates.push({ id: `s${st.n}`, level: p.hit ? (g.score >= 80 ? '能讲给别人听' : '理解') : '模糊' });
      }
    } else {
      for (const id of ids) updates.push({ id, level: g.pass ? (g.score >= 90 ? '能讲给别人听' : '理解') : '模糊' });
    }
    for (const u of updates) await api.profileUpdate({ level: u });
  };

  const submitRetell = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    try {
      const rubric = STAGES.map((st) => `${st.n} ${st.title}：${st.what}`).join('\n');
      const res = await api.tutor({ question: '按 8 个环节逐条打分（perPoint 一个环节一条，point 写成"n 环节名"）。', mode: 'grade-retell', rubric, learnerAnswer: answer, trace: current?.events ?? [] });
      setRaw(res.ok ? (res.answer ?? '') : `导师不可用：${res.reason}`);
      const g = res.ok ? parseGrade(res.answer ?? '') : null;
      setGrade(g);
      if (g) {
        await applyLevels([], g, true);
        await api.profileUpdate({ exam: { type: '复述', id: 'retell', result: g.pass ? '通过' : '未通过', score: g.score } });
        await reloadProfile();
      }
    } finally {
      setBusy(false);
    }
  };

  const submitScenario = async () => {
    if (!answer.trim() || busy || !scenario) return;
    setBusy(true);
    try {
      const res = await api.tutor({ question: `情景题 ${scenario.id}：${scenario.prompt}`, mode: 'grade-scenario', rubric: scenario.rubric.map((r, i) => `${i + 1}. ${r}`).join('\n'), learnerAnswer: answer, trace: current?.events ?? [] });
      setRaw(res.ok ? (res.answer ?? '') : `导师不可用：${res.reason}`);
      const g = res.ok ? parseGrade(res.answer ?? '') : null;
      setGrade(g);
      if (g) {
        await applyLevels(scenario.nodes, g);
        await api.profileUpdate({ exam: { type: '情景题', id: scenario.id, result: g.pass ? '通过' : '未通过', score: g.score } });
        await reloadProfile();
      }
    } finally {
      setBusy(false);
    }
  };

  // ---- drill
  const startDrill = async () => {
    const fault = Math.random() < 0.5 ? 'wake-refused' : 'route-denied';
    await api.setFault(fault, true);
    setDrill({ fault, phase: 'broken', pick: null, result: null, sentId: null, verifyId: null });
  };
  const sendProbe = async (verify: boolean) => {
    dispatch({ type: 'overlay', value: 'none' });
    await send(verify ? 'Recovery check: reply with the single word OK.' : 'Drill: reply with the single word OK.');
    setTimeout(() => dispatch({ type: 'quiz', tab: '排障演练' }), 50);
    const id = s.currentMsgId;
    setDrill((d) => (verify ? { ...d, verifyId: id } : { ...d, sentId: id }));
  };
  const diagnose = async () => {
    if (!drill.pick || !drill.fault) return;
    const ok = drill.pick === drill.fault;
    setDrill((d) => ({ ...d, phase: 'diagnosed', result: ok }));
    const node = drill.fault === 'wake-refused' ? 's4' : 's2';
    await api.profileUpdate({ exam: { type: '排障演练', id: drill.fault, result: ok ? '定位正确' : `定位错误（选了 ${drill.pick}）` } });
    if (ok) await api.profileUpdate({ level: { id: node, level: '能讲给别人听', note: '排障演练定位正确' } });
    await reloadProfile();
  };
  const recover = async () => {
    if (drill.fault) await api.setFault(drill.fault, false);
    setDrill((d) => ({ ...d, phase: 'recovered' }));
  };
  const verifyMsg = drill.verifyId ? s.messages[drill.verifyId] : null;
  const recovered = verifyMsg ? isFinished(verifyMsg.events) && verifyMsg.events.some((e) => e.event === 'deliver:done') : false;

  return (
    <div className="overlay" id="quiz">
      <div className="topbar">
        <div className="brand"><i />考核</div>
        <div className="tabs">
          {(['复述', '情景题', '排障演练'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => dispatch({ type: 'quiz', tab: t })} id={`quiz-tab-${t}`}>{t}</button>
          ))}
        </div>
        <div className="status">
          {tab === '情景题' && <span>第 <b>{scenarioIdx + 1}</b> / {scenarios.length} 题</span>}
          {current && <span>基于消息 {current.msgId}</span>}
          {!tutorOk && tab !== '排障演练' && <span className="err">导师未就绪：{cli?.detail}</span>}
          <button className="btn sm" onClick={() => dispatch({ type: 'overlay', value: 'none' })} id="quiz-close">返回面板 ✕</button>
        </div>
      </div>
      <div className="quiz">
        <div className="l">
          {tab === '复述' && (
            <>
              <div className="h3">复述 · 不看面板，把一条消息从进入到回复的完整流程讲一遍</div>
              <div className="card hi" style={{ fontSize: 14, lineHeight: 1.6 }}>用自己的话讲：消息从哪里进来、经过哪些步骤、每一步做什么、在哪个文件、容器边界在哪里、回复怎么回去。导师按 8 个环节逐条打分。</div>
              <textarea id="retell-input" className="ta" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="从 ① 渠道接收开始…" />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn pri" onClick={submitRetell} disabled={busy || !answer.trim() || !tutorOk} id="retell-submit">{busy ? '打分中…' : '提交'}</button>
              </div>
            </>
          )}
          {tab === '情景题' && scenario && (
            <>
              <div className="h3">情景题 · 涉及 {scenario.nodes.join('、')}</div>
              <div className="card hi" style={{ fontSize: 14, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{scenario.title}</div>
                {scenario.prompt}
              </div>
              <textarea id="scenario-input" className="ta" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="在这里写你的推理。可以用环节编号和文件名，不用背函数名。" />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn pri" onClick={submitScenario} disabled={busy || !answer.trim() || !tutorOk} id="scenario-submit">{busy ? '打分中…' : '提交'}</button>
                <button className="btn" onClick={() => setScenarioIdx((i) => (i + 1) % scenarios.length)} id="scenario-next">下一题</button>
                <span className="dim mono" style={{ marginLeft: 'auto' }}>要点不展示；提交后导师按 {scenario.rubric.length} 条要点逐条判断</span>
              </div>
            </>
          )}
          {tab === '排障演练' && (
            <>
              <div className="h3">排障演练 · 面板里弄坏一个环节，你只借助面板找原因</div>
              {drill.phase === 'idle' && (
                <div className="card hi">
                  <div>点"弄坏一个环节"后，系统会随机打开两个故障开关之一（真的会让某一步失败）。然后你发一条探测消息，用流程图、时间轴和每一步的真实数据找出是哪一步、为什么。</div>
                  <button className="btn pri" style={{ marginTop: 8 }} onClick={startDrill} id="drill-start">弄坏一个环节</button>
                </div>
              )}
              {drill.phase === 'broken' && (
                <div className="card hi">
                  <div>故障已注入。现在：</div>
                  <ol>
                    <li>发一条探测消息（会暂时回到面板，观察后再从底部"考核"回来）。<button className="btn sm" style={{ marginLeft: 8 }} onClick={() => sendProbe(false)} id="drill-send">发探测消息</button></li>
                    <li>看它停在哪一步、那一步的真实数据说了什么。</li>
                    <li>选出原因：</li>
                  </ol>
                  {FAULT_OPTIONS.map((o) => (
                    <button key={o.key} className={`opt ${drill.pick === o.key ? 'sel' : ''}`} onClick={() => setDrill((d) => ({ ...d, pick: o.key }))} id={`drill-pick-${o.key}`}><i /><span>{o.text}</span></button>
                  ))}
                  <button className="btn pri" style={{ marginTop: 8 }} disabled={!drill.pick} onClick={diagnose} id="drill-diagnose">提交诊断</button>
                </div>
              )}
              {drill.phase === 'diagnosed' && (
                <div className={`card ${drill.result ? 'ok' : 'bad'}`}>
                  <div>{drill.result ? <span className="okc">定位正确。</span> : <span className="errc">定位不对。</span>} 实际注入的是 <span className="mono">{drill.fault}</span>：{FAULT_OPTIONS.find((o) => o.key === drill.fault)?.text}</div>
                  <div className="muted" style={{ marginTop: 4 }}>现在恢复：关闭故障开关。{drill.fault === 'wake-refused' ? '被拒的会话由 sweep 每分钟重试，关掉开关后那条探测消息也会被回答。' : '被丢弃的消息不会重发，恢复后新消息正常。'}</div>
                  <button className="btn pri" style={{ marginTop: 8 }} onClick={recover} id="drill-recover">关闭故障并恢复</button>
                </div>
              )}
              {drill.phase === 'recovered' && (
                <div className={`card ${recovered ? 'ok' : ''}`}>
                  <div>故障开关已关。发一条确认消息，收到回复（⑧ deliver:done）就算完全恢复。<button className="btn sm" style={{ marginLeft: 8 }} onClick={() => sendProbe(true)} id="drill-verify">发确认消息</button></div>
                  <div style={{ marginTop: 6 }}>
                    {verifyMsg ? (recovered ? <span className="okc" id="drill-recovered">已恢复：{verifyMsg.msgId} 在 {new Date(verifyMsg.events.find((e) => e.event === 'deliver:done')!.tMs).toLocaleTimeString()} 投递完成</span> : <span className="muted">等待 {verifyMsg.msgId} 走完…</span>) : <span className="dim">还没发确认消息</span>}
                  </div>
                  {recovered && <button className="btn" style={{ marginTop: 8 }} onClick={() => setDrill({ fault: null, phase: 'idle', pick: null, result: null, sentId: null, verifyId: null })} id="drill-again">再来一次</button>}
                </div>
              )}
            </>
          )}
          {grade && (
            <div className={`card ${grade.pass ? 'ok' : 'bad'}`} id="grade-result">
              <div><b>{grade.score} 分 · {grade.pass ? '通过' : '未通过'}</b>{grade.level ? <span className="muted"> · 导师判定：{grade.level}</span> : null}</div>
              {grade.perPoint.map((p, i) => (
                <div key={i} style={{ marginTop: 4 }}><span className={p.hit ? 'okc' : 'errc'}>{p.hit ? '✓' : '✗'}</span> {p.point} <span className="muted">{p.comment}</span></div>
              ))}
              <div className="muted" style={{ marginTop: 6 }}>{grade.feedback}</div>
            </div>
          )}
          {!grade && raw && <div className="card bad"><div className="muted">导师返回的不是打分 JSON：</div><div className="a">{raw.slice(0, 800)}</div></div>}
        </div>
        <div className="r">
          <div className="h3">学习档案 · learner-profile.md</div>
          <div className="card">
            <div className="prof">
              {s.profile?.mastery.map((m) => (
                <span key={m.id} style={{ display: 'contents' }}>
                  <span>{m.title}</span>
                  <span className={`lvl l${['未接触', '模糊', '理解', '能讲给别人听'].indexOf(m.level)}`}>{m.level}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="card">
            <div style={{ marginBottom: 4 }}>我猜错过的</div>
            <div className="muted">{s.profile?.wrongGuesses.length ? s.profile.wrongGuesses.slice(-3).map((g, i) => <div key={i}>{g}</div>) : '（还没有）'}</div>
          </div>
          <div className="card">
            <div style={{ marginBottom: 4 }}>反复追问的</div>
            <div className="muted">{s.profile && Object.keys(s.profile.repeatedQuestions).length ? Object.entries(s.profile.repeatedQuestions).slice(-4).map(([k, v]) => <div key={k}>{k} × {v}</div>) : '（还没有）'}</div>
          </div>
          <div className="card" style={{ borderColor: 'var(--ok)' }}>
            <div style={{ marginBottom: 4 }}>三种考核的记录</div>
            <div className="muted">{s.profile?.exams.length ? s.profile.exams.slice(-5).map((e, i) => <div key={i}>{e}</div>) : '复述：未做 · 情景题：未做 · 排障演练：未做'}</div>
          </div>
        </div>
      </div>
      <div className="foot"><span>答完会更新档案和知识地图</span></div>
    </div>
  );
}
