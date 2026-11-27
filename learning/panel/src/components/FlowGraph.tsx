import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { useMemo } from 'react';

import { STAGES, fmtClock, isFinished, reachedStage } from '../stages';
import { useStore } from '../store';
import type { TraceEvent } from '../types';

type StageNodeData = {
  n: number;
  title: string;
  fn: string;
  file: string;
  status: 'pending' | 'done' | 'cur' | 'fail';
  stamp: string;
  selected: boolean;
  unavailable: string | null;
  onSelect: (n: number) => void;
};

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  const d = data;
  const icon = d.status === 'done' ? '✓' : d.status === 'cur' ? '▶' : d.status === 'fail' ? '✗' : '';
  return (
    <div className={`stage-node ${d.status} ${d.selected ? 'sel' : ''}`} id={`stage-node-${d.n}`} role="button" tabIndex={0}>
      <Handle type="target" position={d.n <= 4 ? Position.Left : d.n === 5 ? Position.Top : Position.Right} style={{ opacity: 0 }} />
      <div className="t"><span className="n">{icon} {d.n}</span>{d.title}</div>
      <div className="f">{d.file.split('/').slice(-1)[0]} · {d.fn}</div>
      <div className="d">{d.stamp}</div>
      {d.unavailable && <div className="na">{d.unavailable}</div>}
      <Handle type="source" position={d.n === 4 ? Position.Bottom : d.n <= 3 ? Position.Right : Position.Left} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { stage: StageNode };

const X = [0, 230, 460, 690];
const Y_HOST = 30;
const Y_CTR = 190;

export function FlowGraph() {
  const { s, dispatch, current, visible } = useStore();
  const revealed = s.mode === 'live' ? 8 : s.step.revealed;
  const all = current?.events ?? [];
  const reachedAll = reachedStage(all);
  const reachedVisible = reachedStage(visible);
  const finished = isFinished(visible);

  const nodes = useMemo<Node<StageNodeData>[]>(() => {
    return STAGES.map((st) => {
      const evs = visible.filter((e) => e.stage === st.n);
      // A stage counts as failed only when the message never got past it; a
      // transient failure followed by progress is shown as done with a note.
      const laterReached = visible.some((e) => e.stage > st.n && e.stage <= 8);
      const failed = evs.some((e) => e.event === 'wake:failed' || e.event === 'deliver:failed' || e.event === 'route:dropped') && !laterReached;
      let status: StageNodeData['status'] = 'pending';
      if (evs.length) {
        if (failed) status = 'fail';
        else if (st.n === reachedVisible && !finished) status = 'cur';
        else status = 'done';
      }
      const first = evs[0] as TraceEvent | undefined;
      const retried = !failed && evs.some((e) => e.event === 'wake:failed' || e.event === 'deliver:failed');
      const stamp = first ? `${fmtClock(first.tMs)} · ${evs.length} 个事件${retried ? ' · 有一次失败' : ''}` : s.mode !== 'live' && reachedAll >= st.n ? '已发生，等你揭示' : current ? '未到达' : '—';
      const pos = st.n <= 4 ? { x: X[st.n - 1], y: Y_HOST } : st.n === 8 ? { x: X[0], y: Y_CTR } : { x: X[8 - st.n], y: Y_CTR };
      const unavailable = st.n === 1 && s.snapshot ? (s.snapshot.channels.length <= 2 ? '只有终端 cli 和面板渠道；WhatsApp 等未安装' : null) : null;
      return {
        id: `s${st.n}`,
        type: 'stage',
        position: pos,
        draggable: false,
        selectable: true,
        data: { n: st.n, title: st.title, fn: st.fn, file: st.file, status, stamp, selected: s.selectedStage === st.n, unavailable, onSelect: (n) => dispatch({ type: 'select', stage: n }) },
      };
    });
  }, [visible, reachedVisible, reachedAll, finished, s.selectedStage, s.mode, s.snapshot, current, dispatch]);

  const edges = useMemo<Edge[]>(() => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8];
    return seq.slice(0, -1).map((a, i) => {
      const b = seq[i + 1];
      const aDone = visible.some((e) => e.stage === a);
      const bDone = visible.some((e) => e.stage === b);
      const cls = bDone ? 'done' : aDone && !finished ? 'cur' : '';
      return { id: `e${a}-${b}`, source: `s${a}`, target: `s${b}`, type: 'smoothstep', className: cls, animated: cls === 'cur' && !s.reducedMotion };
    });
  }, [visible, finished, s.reducedMotion]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }} id="flow">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        onNodeClick={(_, node) => dispatch({ type: 'select', stage: (node.data as StageNodeData).n })}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#17171a" />
      </ReactFlow>
      <div className="rowlabel" style={{ top: 6, left: 16 }}>宿主 NODE 进程 · src/ {s.mode === 'step' && revealed < 8 ? '· 单步：点右栏"猜一猜"揭示下一步' : ''}</div>
      <div className="rowlabel" style={{ bottom: 6, left: 16 }}>AGENT 容器 · container/agent-runner/src/ {current?.events.find((e) => e.event === 'wake:spec')?.data.containerName ? `· ${String(current.events.find((e) => e.event === 'wake:spec')!.data.containerName)}` : ''}</div>
      <div className="rowlabel" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'var(--bg)', padding: '0 8px' }}>容器边界 · 只有 inbound.db 和 outbound.db 穿过</div>
    </div>
  );
}
