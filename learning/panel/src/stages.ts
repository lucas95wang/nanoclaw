import type { TraceEvent } from './types';

/** The eight stages of one message, in true order. Names match references/features/. */
export interface StageMeta {
  n: number;
  id: string;
  title: string;
  side: 'host' | 'container';
  feature: string;
  file: string;
  fn: string;
  what: string;
  why: string;
  /** Events that mean "this stage happened". The first one seen marks arrival. */
  events: string[];
}

export const STAGES: StageMeta[] = [
  { n: 1, id: 's1', title: '渠道接收', side: 'host', feature: '01-receive.md', file: 'src/index.ts', fn: 'initChannelAdapters › onInbound', what: '平台消息变成一个 InboundMessage，经所有渠道共用的入口进入宿主。', why: '宿主不认识任何平台；只认这一个接口，渠道才能随便换。', events: ['inbound'] },
  { n: 2, id: 's2', title: '路由决策', side: 'host', feature: '02-route.md', file: 'src/router.ts', fn: 'routeInbound → evaluateEngage', what: '找到这条聊天的 messaging_group，对每个接线的 agent 判断要不要理（engage）、能不能理（权限）。', why: '一个聊天可以接多个 agent；陌生人和没接线的聊天要在这里拦住。', events: ['route:messaging-group', 'route:engage', 'route:dropped', 'route:command-gate'] },
  { n: 3, id: 's3', title: '会话与收件箱', side: 'host', feature: '03-inbox.md', file: 'src/session-manager.ts', fn: 'resolveSession · writeSessionMessage', what: '找或建这个 agent 在这个聊天里的 session，把消息写进它的 inbound.db。', why: '每个会话一个容器、一对 SQLite 文件；写文件就等于"发给容器"。', events: ['inbox:session', 'inbox:written'] },
  { n: 4, id: 's4', title: '唤醒容器', side: 'host', feature: '04-wake.md', file: 'src/container-runner.ts', fn: 'wakeContainer → spawnContainer', what: '容器没在跑就起一个：拼 CLAUDE.md、算挂载、向 OneCLI 拿 lease、docker create/start；在跑就什么都不做。', why: '隔离：agent 只看得见挂进去的目录；凭证留在网关，不进容器。', events: ['wake:requested', 'wake:already-running', 'wake:spec', 'wake:started', 'wake:failed'] },
  { n: 5, id: 's5', title: '容器取件', side: 'container', feature: '05-poll.md', file: 'container/agent-runner/src/poll-loop.ts', fn: 'runPollLoop → getPendingMessages', what: '容器里的 runner 每秒读 inbound.db，认领 pending 的消息（processing_ack），拼成 XML prompt。', why: '容器只读 inbound、只写 outbound；认领记录写在自己的文件里，两边永远不抢同一个文件。', events: ['poll:claimed', 'poll:prompt'] },
  { n: 6, id: 's6', title: '模型回合', side: 'container', feature: '06-model.md', file: 'container/agent-runner/src/providers/claude.ts', fn: 'query → processQuery', what: '调 Claude Agent SDK：init、文本、工具调用、result；每个事件 touch 一次心跳文件。', why: '真正"思考"的地方；请求经 OneCLI 代理换上真凭证。', events: ['model:init', 'model:text', 'model:tool', 'model:progress', 'model:error', 'model:result'] },
  { n: 7, id: 's7', title: '出件箱', side: 'container', feature: '07-outbox.md', file: 'container/agent-runner/src/db/messages-out.ts', fn: 'dispatchResultText → writeMessageOut', what: '回复写进 outbound.db 的 messages_out；消息标为 completed。', why: '回复也是一条消息，由宿主负责送出；容器永远不碰平台。', events: ['outbox:written', 'poll:completed'] },
  { n: 8, id: 's8', title: '宿主投递', side: 'host', feature: '08-deliver.md', file: 'src/delivery.ts', fn: 'drainSession → deliverMessage', what: '宿主每秒轮询 outbound.db，经 adapter 发回平台，在自己的 inbound.db 记 delivered。', why: '一个文件一个写者：投递记录写在宿主自己的文件里。', events: ['deliver:send', 'deliver:done', 'deliver:failed', 'panel:reply'] },
];

export const STAGE_BY_N = new Map(STAGES.map((s) => [s.n, s]));

export function stageOf(e: TraceEvent): StageMeta | undefined {
  return STAGE_BY_N.get(e.stage);
}

/** Group one message's events by stage, in arrival order. */
export function byStage(events: TraceEvent[]): Map<number, TraceEvent[]> {
  const m = new Map<number, TraceEvent[]>();
  for (const e of events) {
    if (!m.has(e.stage)) m.set(e.stage, []);
    m.get(e.stage)!.push(e);
  }
  return m;
}

export interface Segment {
  n: number;
  startMs: number;
  endMs: number;
  durMs: number;
  reached: boolean;
}

/** Timeline segments: a stage spans from its first event to the next stage's first event. */
export function timeline(events: TraceEvent[]): { t0: number; total: number; segments: Segment[] } {
  const sorted = [...events].filter((e) => e.stage >= 1 && e.stage <= 8).sort((a, b) => a.tMs - b.tMs || a.seq - b.seq);
  const t0 = sorted[0]?.tMs ?? 0;
  const firstByStage = new Map<number, number>();
  const lastByStage = new Map<number, number>();
  for (const e of sorted) {
    if (!firstByStage.has(e.stage)) firstByStage.set(e.stage, e.tMs);
    lastByStage.set(e.stage, e.tMs);
  }
  const last = sorted.length ? sorted[sorted.length - 1].tMs : t0;
  const segments: Segment[] = STAGES.map((s) => {
    const start = firstByStage.get(s.n);
    if (start === undefined) return { n: s.n, startMs: 0, endMs: 0, durMs: 0, reached: false };
    let end = last;
    for (let k = s.n + 1; k <= 8; k++) {
      const nx = firstByStage.get(k);
      if (nx !== undefined) {
        end = nx;
        break;
      }
    }
    if (end < start) end = lastByStage.get(s.n) ?? start;
    return { n: s.n, startMs: start - t0, endMs: end - t0, durMs: Math.max(0, end - start), reached: true };
  });
  return { t0, total: last - t0, segments };
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function fmtClock(tMs: number): string {
  const d = new Date(tMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** Highest stage reached, 0 when none. */
export function reachedStage(events: TraceEvent[]): number {
  let max = 0;
  for (const e of events) if (e.stage >= 1 && e.stage <= 8 && e.stage > max) max = e.stage;
  return max;
}

export function isFinished(events: TraceEvent[]): boolean {
  return events.some((e) => e.event === 'deliver:done' || e.event === 'panel:reply' || e.event === 'route:dropped');
}

/* ---------------------------------------------------------------- guesses */

export interface GuessOption {
  key: string;
  text: string;
}

export interface GuessQuestion {
  stage: number; // the stage about to be revealed
  question: string;
  options: GuessOption[];
  /** Pick the correct key from the real events of that stage; null = cannot judge (no data). */
  answer: (stageEvents: TraceEvent[], all: TraceEvent[]) => string | null;
  explain: (stageEvents: TraceEvent[]) => string;
}

const d = (e: TraceEvent | undefined, k: string): unknown => (e ? e.data[k] : undefined);

export const GUESSES: GuessQuestion[] = [
  {
    stage: 2,
    question: '消息已经进了宿主。路由会怎么处理它？',
    options: [
      { key: 'engage', text: '找到这条聊天的 messaging_group，接线的 agent 会"engage"，进入下一步' },
      { key: 'drop', text: '这条聊天没有接线或发送者被拦，消息被丢弃（dropped_messages）' },
      { key: 'ask', text: '宿主先问 owner 要不要理这个人，等审批' },
    ],
    answer: (ev) => {
      const eng = ev.find((e) => e.event === 'route:engage');
      if (eng) return d(eng, 'outcome') === 'engage' ? 'engage' : 'drop';
      if (ev.some((e) => e.event === 'route:dropped')) return 'drop';
      return null;
    },
    explain: (ev) => {
      const eng = ev.find((e) => e.event === 'route:engage');
      const mg = ev.find((e) => e.event === 'route:messaging-group');
      return eng
        ? `messaging_group ${String(d(mg, 'messagingGroupId'))}，接线 ${String(d(eng, 'agentGroupName'))}，engage_mode=${String(d(eng, 'engageMode'))}，engages=${String(d(eng, 'engages'))}，accessOk=${String(d(eng, 'accessOk'))} → ${String(d(eng, 'outcome'))}`
        : `没有接线的 agent：${String(d(ev.find((e) => e.event === 'route:dropped'), 'reason'))}`;
    },
  },
  {
    stage: 3,
    question: '路由决定让 agent 处理。会话（session）会怎么来？',
    options: [
      { key: 'new', text: '新建一个 session 和它的目录（这是这个聊天第一次找这个 agent）' },
      { key: 'reuse', text: '复用已有的 session（同一个聊天、同一个 agent、同一种 session_mode）' },
    ],
    answer: (ev) => {
      const s = ev.find((e) => e.event === 'inbox:session');
      return s ? (d(s, 'created') ? 'new' : 'reuse') : null;
    },
    explain: (ev) => {
      const s = ev.find((e) => e.event === 'inbox:session');
      return `session ${String(d(s, 'sessionId'))}，created=${String(d(s, 'created'))}，sessionMode=${String(d(s, 'sessionMode'))}，容器状态 ${String(d(s, 'containerStatus'))}；消息写进 inbound.db 的 id 是 ${String(d(s, 'namespacedMessageId'))}`;
    },
  },
  {
    stage: 4,
    question: '消息已写进 inbound.db。宿主接下来会做什么？',
    options: [
      { key: 'warm', text: '容器已经在跑，宿主什么都不做，容器自己轮询会读到' },
      { key: 'spawn', text: '起一个新容器：拼 CLAUDE.md、算挂载、向 OneCLI 拿 lease，再 docker create/start' },
      { key: 'direct', text: '宿主自己调 Claude API，容器只负责工具' },
    ],
    answer: (ev) => {
      if (ev.some((e) => e.event === 'wake:already-running')) return 'warm';
      if (ev.some((e) => e.event === 'wake:spec' || e.event === 'wake:started')) return 'spawn';
      return null;
    },
    explain: (ev) => {
      const spec = ev.find((e) => e.event === 'wake:spec');
      const started = ev.find((e) => e.event === 'wake:started');
      if (spec) {
        const mounts = (d(spec, 'mounts') as unknown[] | undefined)?.length ?? 0;
        return `新起容器 ${String(d(spec, 'containerName'))}，镜像 ${String(d(spec, 'image'))}，${mounts} 个挂载${started ? `，docker create+start 用了 ${String(d(started, 'prepareAndStartMs'))} ms` : ''}`;
      }
      const warm = ev.find((e) => e.event === 'wake:already-running');
      return warm ? `容器 ${String(d(warm, 'containerName'))} 还在跑（热容器），宿主没有起新的` : '没有唤醒数据';
    },
  },
  {
    stage: 5,
    question: '容器起来了。runner 第一轮会怎么拿到消息？',
    options: [
      { key: 'poll', text: '每秒读一次 inbound.db，把 pending 的行标成 processing（写在 outbound.db 的 processing_ack）' },
      { key: 'push', text: '宿主把消息推进容器的 stdin' },
      { key: 'socket', text: '容器连宿主的 socket 拉消息' },
    ],
    answer: (ev) => (ev.some((e) => e.event === 'poll:claimed') ? 'poll' : null),
    explain: (ev) => {
      const c = ev.find((e) => e.event === 'poll:claimed');
      const p = ev.find((e) => e.event === 'poll:prompt');
      return `第 ${String(d(c, 'pollCount'))} 轮轮询认领了 ${((d(c, 'ids') as unknown[]) ?? []).length} 条；continuation=${String(d(p, 'resume') ?? '无（新会话）')}；prompt ${String(d(p, 'promptChars'))} 字符`;
    },
  },
  {
    stage: 6,
    question: 'prompt 已交给 Claude Agent SDK。这一回合会不会调用工具（Bash、Read…）？',
    options: [
      { key: 'tools', text: '会：模型先调工具再回答' },
      { key: 'notools', text: '不会：直接回答' },
    ],
    answer: (ev) => (ev.some((e) => e.event === 'model:result' || e.event === 'model:text') ? (ev.some((e) => e.event === 'model:tool') ? 'tools' : 'notools') : null),
    explain: (ev) => {
      const tools = ev.filter((e) => e.event === 'model:tool').map((e) => String(d(e, 'tool')));
      const init = ev.find((e) => e.event === 'model:init');
      const res = ev.find((e) => e.event === 'model:result');
      return `${tools.length ? `调用了 ${tools.length} 次工具：${tools.join(', ')}` : '本次 0 次工具调用'}；${init ? `SDK 会话 ${String(d(init, 'continuation'))}` : '没有 init 事件（热容器续用已打开的查询）'}；result isError=${String(d(res, 'isError'))}`;
    },
  },
  {
    stage: 7,
    question: '模型写好了回复。它怎么离开容器？',
    options: [
      { key: 'outbox', text: '写一行到 outbound.db 的 messages_out，宿主稍后来读' },
      { key: 'http', text: '容器直接调平台 API 发出去' },
      { key: 'stdout', text: '打印到 stdout，宿主从 docker attach 里收' },
    ],
    answer: (ev) => (ev.some((e) => e.event === 'outbox:written') ? 'outbox' : null),
    explain: (ev) => {
      const o = ev.find((e) => e.event === 'outbox:written');
      return `messages_out 行 ${String(d(o, 'outboundId'))}，seq ${String(d(o, 'seq'))}，in_reply_to=${String(d(o, 'inReplyTo'))}，channel ${String(d(o, 'channelType'))}/${String(d(o, 'platformId'))}`;
    },
  },
  {
    stage: 8,
    question: '回复在 outbound.db 里了。宿主多久会发出去，记在哪里？',
    options: [
      { key: 'poll1s', text: '活跃会话的投递轮询每 1 秒一次；发出后在宿主自己的 inbound.db 记一行 delivered' },
      { key: 'instant', text: '容器写完立刻通知宿主，宿主马上发' },
      { key: 'sweep', text: '要等 60 秒一次的 sweep' },
    ],
    answer: (ev) => (ev.some((e) => e.event === 'deliver:done') ? 'poll1s' : ev.some((e) => e.event === 'deliver:failed') ? null : null),
    explain: (ev) => {
      const s = ev.find((e) => e.event === 'deliver:send');
      const done = ev.find((e) => e.event === 'deliver:done');
      return done
        ? `宿主在 ${fmtClock(done.tMs)} 投递完成（距 outbox ${s ? fmtMs(done.tMs - s.tMs) : '?'}），platformMsgId=${String(d(done, 'platformMsgId'))}`
        : '还没有投递完成的记录';
    },
  },
];

export const GUESS_BY_STAGE = new Map(GUESSES.map((g) => [g.stage, g]));

/* ------------------------------------------------------------ sample messages */

export const SAMPLES: Array<{ label: string; text: string; path: string }> = [
  { label: '普通聊天', text: 'Hi Nano. In one sentence, what can you do?', path: '①→⑧ 不调工具' },
  { label: '要用工具', text: 'Run `df -h /` in your sandbox and tell me the free space in one line.', path: '⑥ 里会出现 Bash 工具调用' },
  { label: '定时提醒', text: 'Create a one-time reminder for 2 minutes from now that says "learning check". Confirm the task id.', path: '⑦ 出现 cli_request 系统消息；任务由 sweep 唤醒' },
  { label: '清空会话 /clear', text: '/clear', path: '⑤ 里 runner 自己处理，不进 ⑥' },
];
