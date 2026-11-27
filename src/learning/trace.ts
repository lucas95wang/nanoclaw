/**
 * Learning trace — observation-only instrumentation for the learning panel.
 *
 * Every call site in core goes through `trace(...)`. When learning mode is
 * off (the default), `isLearning()` is false and `trace` returns before
 * touching anything, so the official start path is byte-for-byte the same
 * behavior. When on (`NANOCLAW_LEARNING=1`), each event is:
 *   1. stamped with a global seq, timestamps and the correlation message id,
 *   2. redacted (message text truncated, secret-shaped values masked),
 *   3. appended to data/learning/traces/<msgKey>.jsonl for replay,
 *   4. pushed to every live subscriber (the SSE endpoint in server.ts).
 *
 * Stage numbers follow the learning map: 1 receive, 2 route, 3 inbox,
 * 4 wake, 5 poll (container), 6 model (container), 7 outbox (container),
 * 8 deliver, 0 for host lifecycle / background mechanisms.
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';

export type Side = 'host' | 'container' | 'panel';

export interface TraceEvent {
  seq: number;
  ts: string;
  tMs: number;
  side: Side;
  stage: number;
  event: string;
  msgId: string | null;
  sessionId: string | null;
  agentGroupId: string | null;
  file: string;
  fn: string;
  data: Record<string, unknown>;
}

export interface TraceInput {
  stage: number;
  event: string;
  msgId?: string | null;
  sessionId?: string | null;
  agentGroupId?: string | null;
  file: string;
  fn: string;
  data?: Record<string, unknown>;
  side?: Side;
  /** Override the timestamp (container events carry their own). */
  tMs?: number;
}

const LEARNING = process.env.NANOCLAW_LEARNING === '1';

export function isLearning(): boolean {
  return LEARNING;
}

export function learningDir(): string {
  return path.join(DATA_DIR, 'learning');
}

export function tracesDir(): string {
  return path.join(learningDir(), 'traces');
}

type Subscriber = (event: TraceEvent) => void;
const subscribers = new Set<Subscriber>();
let seq = 0;

/** session id → the message id most recently written for it (stage 3). */
const lastMsgBySession = new Map<string, string>();
/** Recent events kept in memory for a panel that connects late. */
const RING_MAX = 2000;
const ring: TraceEvent[] = [];

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function recentEvents(): readonly TraceEvent[] {
  return ring;
}

/**
 * A platform message id namespaced per agent (`<id>:<agentGroupId>`, see
 * router.ts messageIdForAgent) maps back to the original id so every stage of
 * one message shares one key. Ids without the suffix pass through.
 */
export function baseMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const idx = id.indexOf(':ag-');
  return idx > 0 ? id.slice(0, idx) : id;
}

export function rememberSessionMessage(sessionId: string, msgId: string | null): void {
  if (!LEARNING || !msgId) return;
  lastMsgBySession.set(sessionId, baseMessageId(msgId) ?? msgId);
}

export function messageForSession(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  return lastMsgBySession.get(sessionId) ?? null;
}

const SECRET_RE = /(sk-ant-[A-Za-z0-9_-]{6,}|xox[abp]-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,})/g;
const SECRET_KEY_RE = /(token|secret|password|api[_-]?key|authorization|credential)/i;
const TEXT_MAX = 400;

/** Mask secret-shaped values, truncate long strings, cap nesting. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') {
    const masked = value.replace(SECRET_RE, (m) => `${m.slice(0, 10)}…(masked)`);
    return masked.length > TEXT_MAX ? `${masked.slice(0, TEXT_MAX)}…(+${masked.length - TEXT_MAX} chars)` : masked;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) && typeof v === 'string' && v.length > 0 ? '(masked)' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'bigint') return `${value}n`;
  return value;
}

function keyFor(msgId: string): string {
  return msgId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function appendToFile(event: TraceEvent): void {
  if (!event.msgId) return;
  try {
    fs.mkdirSync(tracesDir(), { recursive: true });
    fs.appendFileSync(path.join(tracesDir(), `${keyFor(event.msgId)}.jsonl`), JSON.stringify(event) + '\n');
    // eslint-disable-next-line no-catch-all/no-catch-all -- observation must never break the host
  } catch {
    /* ignore: tracing is best-effort */
  }
}

/** Record one event. No-op unless learning mode is on. */
export function trace(input: TraceInput): void {
  if (!LEARNING) return;
  emit(input);
}

/** Same as trace() but used by the container watcher, which already checked the flag. */
export function emit(input: TraceInput): TraceEvent {
  const tMs = input.tMs ?? Date.now();
  const sessionId = input.sessionId ?? null;
  const msgId = baseMessageId(input.msgId) ?? messageForSession(sessionId);
  const event: TraceEvent = {
    seq: ++seq,
    ts: new Date(tMs).toISOString(),
    tMs,
    side: input.side ?? 'host',
    stage: input.stage,
    event: input.event,
    msgId,
    sessionId,
    agentGroupId: input.agentGroupId ?? null,
    file: input.file,
    fn: input.fn,
    data: (redact(input.data ?? {}) as Record<string, unknown>) ?? {},
  };
  ring.push(event);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  appendToFile(event);
  for (const fn of subscribers) {
    try {
      fn(event);
      // eslint-disable-next-line no-catch-all/no-catch-all -- one bad subscriber must not stop the others
    } catch {
      /* ignore */
    }
  }
  return event;
}

/** List stored traces, newest first. */
export function listTraces(): Array<{ msgId: string; file: string; mtimeMs: number; first: TraceEvent | null }> {
  let names: string[];
  try {
    names = fs.readdirSync(tracesDir()).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out = names.map((name) => {
    const file = path.join(tracesDir(), name);
    const stat = fs.statSync(file);
    const first = readTraceFile(file)[0] ?? null;
    return { msgId: first?.msgId ?? name.replace(/\.jsonl$/, ''), file, mtimeMs: stat.mtimeMs, first };
  });
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

export function readTrace(msgId: string): TraceEvent[] {
  return readTraceFile(path.join(tracesDir(), `${keyFor(msgId)}.jsonl`));
}

function readTraceFile(file: string): TraceEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const events: TraceEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TraceEvent);
    } catch {
      /* skip a torn line */
    }
  }
  return events;
}

export function _resetTraceForTesting(): void {
  subscribers.clear();
  ring.length = 0;
  lastMsgBySession.clear();
  seq = 0;
}
