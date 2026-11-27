import { STAGES, fmtClock, fmtMs, timeline } from '../stages';
import { useStore } from '../store';

export function Timeline() {
  const { s, current, visible } = useStore();
  const all = current?.events ?? [];
  const tl = timeline(all);
  const shown = timeline(visible);
  const revealed = s.mode === 'live' ? 8 : s.step.revealed;
  const finishedOk = all.some((e) => e.event === 'deliver:done');
  const failed = !finishedOk && all.some((e) => e.event === 'wake:failed' || e.event === 'deliver:failed' || e.event === 'route:dropped');

  if (!current) {
    return (
      <div className="timeline">
        <div className="meta"><span>时间轴</span><span className="dim">发一条消息后，这里按真实耗时画出 8 个环节</span></div>
        <div className="track">{STAGES.map((st) => <div key={st.n} className="seg" style={{ flex: 1 }} />)}</div>
      </div>
    );
  }
  const total = Math.max(tl.total, 1);
  const unreached = tl.segments.filter((x) => !x.reached).length;
  return (
    <div className="timeline" id="timeline">
      <div className="meta">
        <span>时间轴 · {fmtClock(tl.t0)} 起</span>
        <span>{all.length ? `共 ${fmtMs(tl.total)}` : '等待事件…'}</span>
        {s.mode !== 'live' && <span className="dim">灰段 = 还没揭示</span>}
        {failed && <span className="errc">有环节失败</span>}
      </div>
      <div className="track">
        {tl.segments.map((seg) => {
          const isShown = seg.n <= revealed && seg.reached;
          const cur = isShown && seg.n === Math.min(revealed, shown.segments.filter((x) => x.reached).length ? Math.max(...shown.segments.filter((x) => x.reached).map((x) => x.n)) : 0);
          const stageFailed = !all.some((e) => e.stage > seg.n && e.stage <= 8) && all.some((e) => e.stage === seg.n && (e.event === 'wake:failed' || e.event === 'deliver:failed' || e.event === 'route:dropped'));
          // Reached stages share the track by real duration (6px floor each);
          // unreached ones keep a 6px stub. Widths never exceed the track.
          const w = seg.reached ? `max(6px, calc((100% - ${unreached * 8}px) * ${(seg.durMs / total).toFixed(4)}))` : '6px';
          return (
            <div
              key={seg.n}
              className={`seg ${isShown ? (stageFailed ? 'fail' : cur ? 'cur' : 'done') : ''}`}
              style={{ width: w, flex: 'none' }}
              title={`${seg.n} ${STAGES[seg.n - 1].title} · ${seg.reached ? fmtMs(seg.durMs) : '未到达'}`}
            />
          );
        })}
      </div>
      <div className="labels">
        {tl.segments.map((seg) => (
          <span key={seg.n} className={seg.n <= revealed && seg.reached ? (seg.n === revealed && s.mode !== 'live' ? 'cur' : 'done') : ''}>
            {seg.n} {seg.reached && seg.n <= revealed ? fmtMs(seg.durMs) : seg.reached ? '…' : '–'}
          </span>
        ))}
      </div>
    </div>
  );
}
