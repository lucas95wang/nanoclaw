/**
 * Container-side trace relay.
 *
 * The agent-runner cannot reach the host's SSE server, and it must not gain a
 * new network path just for learning. It writes its events as JSON lines to
 * `/workspace/.learning-trace.jsonl` (the session directory, already mounted
 * read-write) when `/workspace/.learning-trace.on` exists. The host creates
 * that marker before each spawn in learning mode and tails the file here,
 * turning every new line into a TraceEvent with side='container'.
 */
import fs from 'fs';
import path from 'path';

import { log } from '../log.js';
import { sessionDir } from '../session-manager.js';
import { emit, isLearning, messageForSession, rememberBatch, type TraceInput } from './trace.js';

export const TRACE_MARKER = '.learning-trace.on';
export const TRACE_FILE = '.learning-trace.jsonl';

const POLL_MS = 250;
const watched = new Map<string, { offset: number; timer: NodeJS.Timeout; file: string }>();

/** Create the marker so the next container run writes traces. No-op unless learning. */
export function armSessionTrace(agentGroupId: string, sessionId: string): void {
  if (!isLearning()) return;
  const dir = sessionDir(agentGroupId, sessionId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, TRACE_MARKER), '');
    watchSession(agentGroupId, sessionId);
  } catch (err) {
    log.warn('learning: could not arm container trace', { sessionId, err });
  }
}

export function watchSession(agentGroupId: string, sessionId: string): void {
  if (!isLearning() || watched.has(sessionId)) return;
  const file = path.join(sessionDir(agentGroupId, sessionId), TRACE_FILE);
  // Start from the current end: older lines belong to earlier runs and are
  // already in the per-message trace files.
  let offset = 0;
  try {
    offset = fs.statSync(file).size;
  } catch {
    offset = 0;
  }
  const entry = { offset, file, timer: setInterval(() => drain(sessionId, agentGroupId), POLL_MS) };
  entry.timer.unref();
  watched.set(sessionId, entry);
}

export function unwatchSession(sessionId: string): void {
  const entry = watched.get(sessionId);
  if (!entry) return;
  clearInterval(entry.timer);
  watched.delete(sessionId);
}

function drain(sessionId: string, agentGroupId: string): void {
  const entry = watched.get(sessionId);
  if (!entry) return;
  let size: number;
  try {
    size = fs.statSync(entry.file).size;
  } catch {
    return;
  }
  if (size < entry.offset) entry.offset = 0; // file was truncated by a fresh run
  if (size === entry.offset) return;
  const fd = fs.openSync(entry.file, 'r');
  try {
    const buf = Buffer.alloc(size - entry.offset);
    fs.readSync(fd, buf, 0, buf.length, entry.offset);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return; // partial line, wait for more
    entry.offset += Buffer.byteLength(text.slice(0, lastNl + 1));
    for (const line of text.slice(0, lastNl).split('\n')) {
      if (!line.trim()) continue;
      let parsed: Partial<TraceInput> & { tMs?: number };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const event = String(parsed.event ?? 'unknown');
      // A warm container keeps one SDK query open across turns, so the runner
      // tags model events with the FIRST batch's id. The message the host wrote
      // most recently to this session is the one being answered.
      const msgId = event.startsWith('model:') ? (messageForSession(sessionId) ?? parsed.msgId ?? null) : (parsed.msgId ?? null);
      if (event === 'poll:claimed' && Array.isArray(parsed.data?.ids)) rememberBatch((parsed.data.ids as unknown[]).map(String));
      emit({
        side: 'container',
        stage: typeof parsed.stage === 'number' ? parsed.stage : 0,
        event,
        msgId,
        sessionId,
        agentGroupId,
        file: String(parsed.file ?? 'container/agent-runner/src/poll-loop.ts'),
        fn: String(parsed.fn ?? ''),
        data: (parsed.data as Record<string, unknown>) ?? {},
        tMs: typeof parsed.tMs === 'number' ? parsed.tMs : undefined,
      });
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function _resetContainerTraceForTesting(): void {
  for (const id of [...watched.keys()]) unwatchSession(id);
}
