import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';

import { api, subscribeEvents } from './api';
import { GUESS_BY_STAGE, isFinished, reachedStage } from './stages';
import type { Mode, NodesFile, PanelReply, Profile, ProfileSummary, StateSnapshot, TraceEvent } from './types';

export interface MessageRecord {
  msgId: string;
  text: string;
  startedMs: number;
  events: TraceEvent[];
  replies: PanelReply[];
  source: 'panel' | 'channel' | 'replay';
}

export interface StepState {
  /** Stages ≤ revealed are shown; the next one waits for a guess. */
  revealed: number;
  /** Last guess outcome shown in the details panel. */
  last: { stage: number; guessed: string; answer: string | null; correct: boolean | null; explain: string } | null;
  skipped: boolean;
}

export interface State {
  connected: boolean;
  snapshot: StateSnapshot | null;
  nodes: NodesFile | null;
  profile: Profile | null;
  summary: ProfileSummary | null;
  messages: Record<string, MessageRecord>;
  order: string[];
  currentMsgId: string | null;
  mode: Mode;
  step: StepState;
  selectedStage: number | null;
  reducedMotion: boolean;
  overlay: 'none' | 'map' | 'quiz' | 'welcome';
  quizTab: '复述' | '情景题' | '排障演练';
  quizNode: string | null;
  faults: string[];
  sending: boolean;
  error: string | null;
}

type Action =
  | { type: 'connected'; value: boolean }
  | { type: 'snapshot'; value: StateSnapshot }
  | { type: 'nodes'; value: NodesFile }
  | { type: 'profile'; profile: Profile; summary?: ProfileSummary }
  | { type: 'trace'; event: TraceEvent }
  | { type: 'traces'; events: TraceEvent[]; source: MessageRecord['source'] }
  | { type: 'sent'; msgId: string; text: string }
  | { type: 'reply'; reply: PanelReply }
  | { type: 'mode'; value: Mode }
  | { type: 'select'; stage: number | null }
  | { type: 'current'; msgId: string | null }
  | { type: 'reveal'; revealed: number; last?: StepState['last']; skipped?: boolean }
  | { type: 'reducedMotion'; value: boolean }
  | { type: 'overlay'; value: State['overlay'] }
  | { type: 'quiz'; tab?: State['quizTab']; node?: string | null }
  | { type: 'faults'; value: string[] }
  | { type: 'sending'; value: boolean }
  | { type: 'error'; value: string | null };

const initial: State = {
  connected: false,
  snapshot: null,
  nodes: null,
  profile: null,
  summary: null,
  messages: {},
  order: [],
  currentMsgId: null,
  mode: 'live',
  step: { revealed: 8, last: null, skipped: false },
  selectedStage: null,
  reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  overlay: 'none',
  quizTab: '情景题',
  quizNode: null,
  faults: [],
  sending: false,
  error: null,
};

function upsertEvent(messages: Record<string, MessageRecord>, order: string[], e: TraceEvent, source: MessageRecord['source']): { messages: Record<string, MessageRecord>; order: string[] } {
  if (!e.msgId) return { messages, order };
  const existing = messages[e.msgId];
  if (existing) {
    if (existing.events.some((x) => x.seq === e.seq && x.tMs === e.tMs && x.event === e.event)) return { messages, order };
    const events = [...existing.events, e].sort((a, b) => a.tMs - b.tMs || a.seq - b.seq);
    const text = existing.text || textOf(e);
    return { messages: { ...messages, [e.msgId]: { ...existing, events, text } }, order };
  }
  const rec: MessageRecord = { msgId: e.msgId, text: textOf(e), startedMs: e.tMs, events: [e], replies: [], source: e.msgId.startsWith('web-') ? 'panel' : source };
  return { messages: { ...messages, [e.msgId]: rec }, order: [...order, e.msgId] };
}

function textOf(e: TraceEvent): string {
  const c = e.data.content as { text?: string } | string | undefined;
  if (e.event === 'inbound' && c && typeof c === 'object' && typeof c.text === 'string') return c.text;
  if (e.event === 'panel:sent' && typeof e.data.text === 'string') return e.data.text;
  return '';
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'connected':
      return { ...s, connected: a.value };
    case 'snapshot':
      return { ...s, snapshot: a.value, faults: a.value.faults };
    case 'nodes':
      return { ...s, nodes: a.value };
    case 'profile':
      return { ...s, profile: a.profile, summary: a.summary ?? s.summary };
    case 'trace': {
      const { messages, order } = upsertEvent(s.messages, s.order, a.event, 'channel');
      const isNew = !s.messages[a.event.msgId ?? ''] && !!a.event.msgId;
      // A message that genuinely enters the system (stage 1 inbound) becomes
      // current, unless the learner is mid-step on another one. Late events of
      // an older message never steal the view.
      let currentMsgId = s.currentMsgId;
      let step = s.step;
      if (isNew && a.event.msgId && a.event.event === 'inbound' && (s.mode === 'live' || !s.currentMsgId || isFinished(s.messages[s.currentMsgId]?.events ?? []))) {
        currentMsgId = a.event.msgId;
        step = s.mode === 'step' ? { revealed: 1, last: null, skipped: false } : s.step;
      }
      return { ...s, messages, order, currentMsgId, step };
    }
    case 'traces': {
      let messages = s.messages;
      let order = s.order;
      for (const e of a.events) ({ messages, order } = upsertEvent(messages, order, e, a.source));
      return { ...s, messages, order };
    }
    case 'sent': {
      const rec: MessageRecord = s.messages[a.msgId] ?? { msgId: a.msgId, text: a.text, startedMs: Date.now(), events: [], replies: [], source: 'panel' };
      return {
        ...s,
        messages: { ...s.messages, [a.msgId]: { ...rec, text: a.text, source: 'panel' } },
        order: s.order.includes(a.msgId) ? s.order : [...s.order, a.msgId],
        currentMsgId: a.msgId,
        step: s.mode === 'step' ? { revealed: 1, last: null, skipped: false } : s.step,
        selectedStage: null,
      };
    }
    case 'reply': {
      // Match the reply to its message through deliver:done (outboundId) or fall back to the current one.
      const outId = a.reply.id.split(':').slice(1).join(':');
      let target = s.currentMsgId;
      for (const id of [...s.order].reverse()) {
        if (s.messages[id].events.some((e) => e.event === 'deliver:done' && e.data.outboundId === outId)) {
          target = id;
          break;
        }
      }
      if (!target || !s.messages[target]) return s;
      const rec = s.messages[target];
      if (rec.replies.some((r) => r.id === a.reply.id)) return s;
      return { ...s, messages: { ...s.messages, [target]: { ...rec, replies: [...rec.replies, a.reply] } } };
    }
    case 'mode':
      return { ...s, mode: a.value, step: a.value === 'live' ? { revealed: 8, last: null, skipped: false } : { revealed: a.value === 'replay' ? 0 : 1, last: null, skipped: false } };
    case 'select':
      return { ...s, selectedStage: a.stage };
    case 'current':
      return { ...s, currentMsgId: a.msgId, step: s.mode === 'live' ? s.step : { revealed: s.mode === 'replay' ? 0 : 1, last: null, skipped: false }, selectedStage: null };
    case 'reveal':
      return { ...s, step: { revealed: a.revealed, last: a.last ?? s.step.last, skipped: a.skipped ?? false }, selectedStage: a.revealed >= 1 ? a.revealed : s.selectedStage };
    case 'reducedMotion':
      return { ...s, reducedMotion: a.value };
    case 'overlay':
      return { ...s, overlay: a.value };
    case 'quiz':
      return { ...s, quizTab: a.tab ?? s.quizTab, quizNode: a.node === undefined ? s.quizNode : a.node, overlay: 'quiz' };
    case 'faults':
      return { ...s, faults: a.value };
    case 'sending':
      return { ...s, sending: a.value };
    case 'error':
      return { ...s, error: a.value };
    default:
      return s;
  }
}

interface Store {
  s: State;
  dispatch: (a: Action) => void;
  send: (text: string) => Promise<void>;
  reloadProfile: () => Promise<void>;
  loadTrace: (msgId: string, mode?: Mode) => Promise<void>;
  /** Visible events of the current message under the current mode. */
  visible: TraceEvent[];
  current: MessageRecord | null;
  /** The next stage waiting to be revealed in step/replay mode (null when none). */
  pendingStage: number | null;
  pendingReady: boolean;
  revealNext: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const sRef = useRef(s);
  sRef.current = s;

  useEffect(() => {
    const off = subscribeEvents({
      onOpen: () => dispatch({ type: 'connected', value: true }),
      onError: () => dispatch({ type: 'connected', value: false }),
      onHello: ({ recent, state }) => {
        dispatch({ type: 'snapshot', value: state });
        dispatch({ type: 'traces', events: recent, source: 'channel' });
      },
      onTrace: (event) => dispatch({ type: 'trace', event }),
      onReply: (reply) => dispatch({ type: 'reply', reply: reply as PanelReply }),
      onProfile: ({ profile }) => dispatch({ type: 'profile', profile }),
      onFaults: ({ active }) => dispatch({ type: 'faults', value: active }),
    });
    api.nodes().then((n) => dispatch({ type: 'nodes', value: n })).catch((e) => dispatch({ type: 'error', value: String(e) }));
    api
      .profile()
      .then(({ profile, summary }) => dispatch({ type: 'profile', profile, summary }))
      .catch((e) => dispatch({ type: 'error', value: String(e) }));
    const t = setInterval(() => api.state().then((v) => dispatch({ type: 'snapshot', value: v })).catch(() => undefined), 15000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const send = useCallback(async (text: string) => {
    dispatch({ type: 'sending', value: true });
    dispatch({ type: 'error', value: null });
    try {
      const { msgId } = await api.chat(text);
      dispatch({ type: 'sent', msgId, text });
    } catch (e) {
      dispatch({ type: 'error', value: `发送失败：${String(e)}` });
    } finally {
      dispatch({ type: 'sending', value: false });
    }
  }, []);

  const reloadProfile = useCallback(async () => {
    const { profile, summary } = await api.profile();
    dispatch({ type: 'profile', profile, summary });
  }, []);

  const loadTrace = useCallback(async (msgId: string, mode: Mode = 'replay') => {
    const events = await api.trace(msgId);
    dispatch({ type: 'traces', events, source: 'replay' });
    dispatch({ type: 'mode', value: mode });
    dispatch({ type: 'current', msgId });
  }, []);

  const current = s.currentMsgId ? (s.messages[s.currentMsgId] ?? null) : null;
  const revealed = s.mode === 'live' ? 8 : s.step.revealed;
  const visible = useMemo(() => (current ? current.events.filter((e) => e.stage === 0 || e.stage <= revealed) : []), [current, revealed]);
  const reached = current ? reachedStage(current.events) : 0;
  const pendingStage = s.mode !== 'live' && current && revealed < 8 && (revealed < reached || (s.mode === 'replay' && revealed < reached)) ? revealed + 1 : null;
  const pendingReady = pendingStage !== null && reached >= pendingStage;

  const revealNext = useCallback(() => {
    const st = sRef.current;
    if (st.mode === 'live') return;
    const next = Math.min(8, st.step.revealed + 1);
    dispatch({ type: 'reveal', revealed: next, skipped: !GUESS_BY_STAGE.has(next) ? false : true });
  }, []);

  const value: Store = { s, dispatch, send, reloadProfile, loadTrace, visible, current, pendingStage, pendingReady, revealNext };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}
