import { useMemo, useState } from 'react';

import { useStore } from '../store';
import type { Level, NodeDef } from '../types';

const LV: Record<Level, number> = { 未接触: 0, 模糊: 1, 理解: 2, 能讲给别人听: 3 };

export function KnowledgeMap() {
  const { s, dispatch, loadTrace } = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const nodes = s.nodes;
  const profile = s.profile;

  const layout = useMemo(() => {
    if (!nodes) return null;
    const W = 1240;
    const stageW = 134, stageH = 56, gap = 16;
    const stages = nodes.stages.map((n, i) => ({ n, x: 22 + i * (stageW + gap), y: 226, w: stageW, h: stageH }));
    const base = nodes.mechanisms.filter((m) => m.group === 'base');
    const side = nodes.mechanisms.filter((m) => m.group !== 'base');
    const bw = Math.min(160, (W - 44 - (base.length - 1) * 16) / base.length);
    const baseL = base.map((n, i) => ({ n, x: 22 + i * (bw + 16), y: 56, w: bw, h: 50 }));
    const sw = Math.min(180, (W - 44 - (side.length - 1) * 16) / side.length);
    const sideL = side.map((n, i) => ({ n, x: 22 + i * (sw + 16), y: 388, w: sw, h: 50 }));
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const b of [...stages, ...baseL, ...sideL]) pos.set(b.n.id, { x: b.x, y: b.y, w: b.w, h: b.h });
    return { W, stages, baseL, sideL, pos };
  }, [nodes]);

  if (!nodes || !layout || !profile) return null;
  const level = (id: string): Level => profile.mastery.find((m) => m.id === id)?.level ?? '未接触';
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<number, number>;
  for (const m of profile.mastery) counts[LV[m.level]]++;
  const selected = sel ? [...nodes.stages, ...nodes.mechanisms].find((n) => n.id === sel) ?? null : null;
  const wrong = selected ? profile.wrongGuesses.filter((g) => g.includes(` ${selected.id} `)) : [];
  const asked = selected ? Object.entries(profile.repeatedQuestions).filter(([k]) => k.startsWith(`${selected.id} `)) : [];
  const due = selected ? profile.reviewDue[selected.id] : undefined;
  const lastMsgId = s.order.length ? s.order[s.order.length - 1] : null;

  const node = (n: NodeDef, b: { x: number; y: number; w: number; h: number }) => {
    const lv = level(n.id);
    return (
      <g key={n.id} className={`mapnode l${LV[lv]} ${sel === n.id ? 'sel' : ''}`} transform={`translate(${b.x},${b.y})`} onClick={() => setSel(n.id)} id={`map-${n.id}`}>
        <rect width={b.w} height={b.h} rx="6" />
        <text className="t" x="12" y="22">{n.stage ? `${n.stage} ` : ''}{n.title}</text>
        <text className="s" x="12" y="40">{lv}{due && due <= new Date().toISOString().slice(0, 10) ? ' · 待回考' : ''}</text>
      </g>
    );
  };
  const edge = (from: string, to: string, hot: boolean) => {
    const a = layout.pos.get(from), b = layout.pos.get(to);
    if (!a || !b) return null;
    const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
    const ay = a.y < b.y ? a.y + a.h : a.y;
    const by = a.y < b.y ? b.y : b.y + b.h;
    const my = (ay + by) / 2;
    return <path key={`${from}-${to}`} className={`mapedge ${hot ? 'hot' : ''}`} d={`M${ax} ${ay} C${ax} ${my} ${bx} ${my} ${bx} ${by}`} />;
  };

  return (
    <div className="overlay" id="knowledge-map">
      <div className="topbar">
        <div className="brand"><i />NanoClaw 知识地图</div>
        <div className="status">
          <span>已掌握 <b>{counts[2] + counts[3]}</b> / {profile.mastery.length}</span>
          <span>能讲给别人听 {counts[3]} · 理解 {counts[2]} · 模糊 {counts[1]} · 未接触 {counts[0]}</span>
          <button className="btn sm" onClick={() => dispatch({ type: 'overlay', value: 'none' })} id="map-close">关闭 ✕</button>
        </div>
      </div>
      <div className="map">
        <svg viewBox={`0 0 ${layout.W} 640`} width="100%" style={{ maxWidth: layout.W, display: 'block' }}>
          <text x="22" y="40" fill="#8a8a8e" fontSize="11" letterSpacing=".06em">进入之前 · 宿主的底座</text>
          <text x="22" y="210" fill="#8a8a8e" fontSize="11" letterSpacing=".06em">主路径 · 一条消息的 8 个环节</text>
          <text x="22" y="372" fill="#8a8a8e" fontSize="11" letterSpacing=".06em">旁路 · 不等消息也在转的东西</text>
          {/* container boundary around stages 5–7 */}
          {(() => {
            const a = layout.pos.get('s5'), b = layout.pos.get('s7');
            if (!a || !b) return null;
            const x1 = Math.min(a.x, b.x) - 10, x2 = Math.max(a.x + a.w, b.x + b.w) + 10;
            return (
              <>
                <rect x={x1} y={a.y - 12} width={x2 - x1} height={a.h + 24} rx="8" fill="none" stroke="#232326" strokeDasharray="4 4" />
                <text x={x1 + 10} y={a.y + a.h + 24} fill="#55555b" fontSize="11">容器内</text>
              </>
            );
          })()}
          {nodes.mechanisms.flatMap((m) => (m.uses ?? []).map((u) => edge(m.id, u, sel === m.id || sel === u)))}
          {layout.stages.slice(0, -1).map((st, i) => {
            const nx = layout.stages[i + 1];
            return <line key={`l${i}`} x1={st.x + st.w} y1={st.y + st.h / 2} x2={nx.x} y2={nx.y + nx.h / 2} stroke="#3a3a40" />;
          })}
          {layout.baseL.map((b) => node(b.n, b))}
          {layout.stages.map((b) => node(b.n, b))}
          {layout.sideL.map((b) => node(b.n, b))}
          {selected && (
            <g transform="translate(472,470)">
              <rect width="440" height="140" rx="6" fill="#121214" stroke="#4f8cff" strokeWidth="1.5" />
              <text x="16" y="24" fill="#e6e6e6" fontSize="12" fontWeight="600">{selected.stage ? `${selected.stage} ` : ''}{selected.title} · {level(selected.id)}</text>
              <text x="16" y="44" fill="#8a8a8e" fontSize="11">{wrong.length ? `猜错 ${wrong.length} 次：${wrong[wrong.length - 1].slice(11, 70)}` : '没有猜错记录'}</text>
              <text x="16" y="62" fill="#8a8a8e" fontSize="11">{asked.length ? `追问过：${asked.map(([k, v]) => `${k.slice(selected.id.length + 1, selected.id.length + 25)} ×${v}`).join('；').slice(0, 60)}` : '没有追问记录'}</text>
              <text x="16" y="84" fill="#8a8a8e" fontSize="11">{due ? `下次回考：${due}` : '没有安排回考'} · feature map：{selected.feature}</text>
            </g>
          )}
          <g fontSize="11" transform="translate(22,600)">
            <rect x="0" y="0" width="12" height="12" rx="3" fill="#121214" stroke="#3ddc97" /><text x="18" y="10" fill="#8a8a8e">能讲给别人听</text>
            <rect x="110" y="0" width="12" height="12" rx="3" fill="#121214" stroke="#8a8a8e" /><text x="128" y="10" fill="#8a8a8e">理解</text>
            <rect x="170" y="0" width="12" height="12" rx="3" fill="#121214" stroke="#4f8cff" /><text x="188" y="10" fill="#8a8a8e">当前选中</text>
            <rect x="260" y="0" width="12" height="12" rx="3" fill="#121214" stroke="#2a2a2e" /><text x="278" y="10" fill="#8a8a8e">模糊 / 未接触（灰）</text>
            <text x="420" y="10" fill="#55555b">连线 = 谁用到谁；点节点 → 下面出现复习 / 考核 / 回放</text>
          </g>
        </svg>
        {selected && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn pri"
              id="map-review"
              onClick={() => {
                dispatch({ type: 'overlay', value: 'none' });
                if (selected.stage) dispatch({ type: 'select', stage: selected.stage });
              }}
            >
              复习（看 {selected.stage ? '这一环节的数据和' : ''} feature map）
            </button>
            <button className="btn" id="map-quiz" onClick={() => dispatch({ type: 'quiz', tab: '情景题', node: selected.id })}>考核这个节点</button>
            {lastMsgId && selected.stage && (
              <button className="btn" id="map-replay" onClick={() => { dispatch({ type: 'overlay', value: 'none' }); loadTrace(lastMsgId, 'replay'); }}>
                回放上一条消息
              </button>
            )}
          </div>
        )}
      </div>
      <div className="foot"><span>Esc 关闭</span></div>
    </div>
  );
}
