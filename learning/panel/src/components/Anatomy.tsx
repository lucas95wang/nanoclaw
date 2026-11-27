import { useStore } from '../store';

/**
 * Two small "anatomy" figures: the object's working is the mechanism, and
 * every number shown comes from the real trace of the current message.
 * Nothing here is hard-coded data; when the trace lacks a value, the figure
 * says so instead of inventing one.
 */
export function Anatomy({ kind }: { kind: 'mailbox' | 'sweep' }) {
  const { current, visible } = useStore();
  const ev = visible;
  if (kind === 'mailbox') {
    const inbox = ev.filter((e) => e.event === 'inbox:written').length;
    const claimed = ev.filter((e) => e.event === 'poll:claimed').length;
    const outbox = ev.filter((e) => e.event === 'outbox:written').length;
    const delivered = ev.filter((e) => e.event === 'deliver:done').length;
    const dir = String(ev.find((e) => e.event === 'inbox:written')?.data.sessionDir ?? '');
    const hostWriting = inbox > 0 && claimed === 0;
    const ctrWriting = outbox > delivered;
    return (
      <div className="anat" id="anatomy-mailbox">
        <svg viewBox="0 0 380 150" role="img" aria-label="两个邮筒：宿主只往 inbound 投，容器只往 outbound 投">
          <defs>
            <linearGradient id="mb" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1d1d21" /><stop offset="1" stopColor="#121214" /></linearGradient>
          </defs>
          <rect x="0" y="0" width="380" height="150" fill="none" />
          {/* host side */}
          <text x="14" y="18" fill="#8a8a8e" fontSize="10" letterSpacing=".06em">宿主</text>
          <text x="330" y="18" fill="#8a8a8e" fontSize="10" letterSpacing=".06em">容器</text>
          <line x1="190" y1="8" x2="190" y2="142" stroke="#2e2e33" strokeDasharray="4 4" />
          {/* inbound.db mailbox */}
          <g>
            <rect x="60" y="40" width="80" height="78" rx="6" fill="url(#mb)" stroke={hostWriting ? '#4f8cff' : '#2e2e33'} />
            <rect x="70" y="50" width="60" height="8" rx="2" fill="#0b0b0c" stroke="#2e2e33" />
            <text x="100" y="80" textAnchor="middle" fill="#e6e6e6" fontSize="10" fontFamily="JetBrains Mono">inbound.db</text>
            <text x="100" y="96" textAnchor="middle" fill="#8a8a8e" fontSize="9.5" fontFamily="JetBrains Mono">messages_in {inbox}</text>
            <text x="100" y="109" textAnchor="middle" fill="#8a8a8e" fontSize="9.5" fontFamily="JetBrains Mono">delivered {delivered}</text>
            {/* host writes in: arrow from left into the slot */}
            <path d="M22 54 H64" stroke={inbox ? '#4f8cff' : '#55555b'} strokeWidth="1.5" markerEnd="url(#arr)" />
            <text x="18" y="46" fill="#55555b" fontSize="9">宿主写</text>
            {/* container reads: dotted arrow from the right */}
            <path d="M176 70 H142" stroke="#55555b" strokeDasharray="2 3" markerEnd="url(#arr)" />
            <text x="146" y="64" fill="#55555b" fontSize="9">容器只读</text>
          </g>
          {/* outbound.db mailbox */}
          <g>
            <rect x="240" y="40" width="80" height="78" rx="6" fill="url(#mb)" stroke={ctrWriting ? '#4f8cff' : '#2e2e33'} />
            <rect x="250" y="50" width="60" height="8" rx="2" fill="#0b0b0c" stroke="#2e2e33" />
            <text x="280" y="80" textAnchor="middle" fill="#e6e6e6" fontSize="10" fontFamily="JetBrains Mono">outbound.db</text>
            <text x="280" y="96" textAnchor="middle" fill="#8a8a8e" fontSize="9.5" fontFamily="JetBrains Mono">messages_out {outbox}</text>
            <text x="280" y="109" textAnchor="middle" fill="#8a8a8e" fontSize="9.5" fontFamily="JetBrains Mono">processing_ack {claimed}</text>
            <path d="M358 54 H324" stroke={outbox ? '#4f8cff' : '#55555b'} strokeWidth="1.5" markerEnd="url(#arr)" />
            <text x="330" y="46" fill="#55555b" fontSize="9">容器写</text>
            <path d="M204 70 H238" stroke="#55555b" strokeDasharray="2 3" markerEnd="url(#arr)" />
            <text x="200" y="64" fill="#55555b" fontSize="9">宿主只读</text>
          </g>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#55555b" /></marker>
          </defs>
          <text x="190" y="138" textAnchor="middle" fill="#55555b" fontSize="9" fontFamily="JetBrains Mono">{dir ? dir.replace(/^.*data\//, 'data/') : '（这条消息还没有写入收件箱）'}</text>
        </svg>
        <div className="cap">双信箱：每个文件只有一个写者，两个文件就是容器边界上唯一的通道。数字是这条消息的真实行数。</div>
      </div>
    );
  }
  // sweep: a 60 s dial and a heartbeat counter from real model events
  const modelEvents = ev.filter((e) => e.stage === 6);
  const beats = modelEvents.length;
  const lastBeat = modelEvents.length ? modelEvents[modelEvents.length - 1].tMs : null;
  const started = ev.find((e) => e.event === 'wake:started')?.tMs ?? current?.startedMs ?? null;
  const ended = ev.find((e) => e.event === 'container:ended')?.tMs ?? null;
  const ceilingMin = 30;
  const sinceBeatSec = lastBeat && !ended ? Math.max(0, Math.round((Date.now() - lastBeat) / 1000)) : null;
  const angle = sinceBeatSec === null ? 0 : Math.min(360, (sinceBeatSec / (ceilingMin * 60)) * 360);
  const rad = ((angle - 90) * Math.PI) / 180;
  const cx = 90, cy = 78, r = 44;
  const hx = cx + r * Math.cos(rad), hy = cy + r * Math.sin(rad);
  return (
    <div className="anat" id="anatomy-sweep">
      <svg viewBox="0 0 380 150" role="img" aria-label="心跳表盘：每个模型事件拨一次，30 分钟没动宿主就回收容器">
        <circle cx={cx} cy={cy} r={r} fill="#121214" stroke="#2e2e33" />
        {[0, 90, 180, 270].map((a) => {
          const t = ((a - 90) * Math.PI) / 180;
          return <line key={a} x1={cx + (r - 6) * Math.cos(t)} y1={cy + (r - 6) * Math.sin(t)} x2={cx + r * Math.cos(t)} y2={cy + r * Math.sin(t)} stroke="#55555b" />;
        })}
        <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={angle > 300 ? '#ff5c5c' : '#4f8cff'} strokeWidth="2" />
        <circle cx={cx} cy={cy} r="3" fill="#4f8cff" />
        <text x={cx} y={cy + r + 16} textAnchor="middle" fill="#8a8a8e" fontSize="9.5" fontFamily="JetBrains Mono">一圈 = {ceilingMin} min ceiling</text>
        <text x="170" y="40" fill="#e6e6e6" fontSize="11">心跳文件 /workspace/.heartbeat</text>
        <text x="170" y="58" fill="#8a8a8e" fontSize="10" fontFamily="JetBrains Mono">本回合 touch 了 {beats} 次（每个模型事件一次）</text>
        <text x="170" y="74" fill="#8a8a8e" fontSize="10" fontFamily="JetBrains Mono">{lastBeat ? `最后一次 ${new Date(lastBeat).toLocaleTimeString()}` : '还没有模型事件'}</text>
        <text x="170" y="90" fill="#8a8a8e" fontSize="10" fontFamily="JetBrains Mono">{ended ? `容器已结束（${String(ev.find((e) => e.event === 'container:ended')?.data.stopReason ?? '')}）` : sinceBeatSec !== null ? `距最后心跳 ${sinceBeatSec} s` : started ? '容器已起，等模型事件' : '容器未起'}</text>
        <text x="170" y="112" fill="#55555b" fontSize="9.5">sweep 每 60 s 看一次：心跳超过 {ceilingMin} min 没动 → 杀容器；</text>
        <text x="170" y="126" fill="#55555b" fontSize="9.5">消息 processing 超过 60 s 且心跳没动 → 杀容器并重排消息。</text>
      </svg>
      <div className="cap">心跳与 sweep：指针按这条消息的真实时间走，不是动画。</div>
    </div>
  );
}
