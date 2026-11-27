/**
 * Container-side learning trace.
 *
 * Writes one JSON line per event to /workspace/.learning-trace.jsonl, but
 * only when the host armed this session by creating
 * /workspace/.learning-trace.on before the spawn (learning mode). The check
 * happens once at first use, so the normal runner pays one stat() per
 * process and nothing else. The host tails the file and relays each line to
 * the panel (src/learning/container-trace.ts); nothing here opens a socket.
 */
import fs from 'fs';

const WORKSPACE = '/workspace';
const MARKER = `${WORKSPACE}/.learning-trace.on`;
const FILE = `${WORKSPACE}/.learning-trace.jsonl`;

let enabled: boolean | null = null;

function isEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = fs.existsSync(process.env.NANOCLAW_LEARNING_TRACE_MARKER || MARKER);
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

/** `<id>:<agentGroupId>` → `<id>` so container events share the host's key. */
export function baseMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const idx = id.indexOf(':ag-');
  return idx > 0 ? id.slice(0, idx) : id;
}

const TEXT_MAX = 400;
function clip(value: unknown): unknown {
  if (typeof value === 'string') return value.length > TEXT_MAX ? `${value.slice(0, TEXT_MAX)}…(+${value.length - TEXT_MAX} chars)` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(clip);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = clip(v);
    return out;
  }
  return value;
}

export interface ContainerTraceInput {
  stage: number;
  event: string;
  msgId?: string | null;
  file?: string;
  fn?: string;
  data?: Record<string, unknown>;
}

export function ltrace(input: ContainerTraceInput): void {
  if (!isEnabled()) return;
  const line = JSON.stringify({
    tMs: Date.now(),
    stage: input.stage,
    event: input.event,
    msgId: baseMessageId(input.msgId),
    file: input.file ?? 'container/agent-runner/src/poll-loop.ts',
    fn: input.fn ?? '',
    data: clip(input.data ?? {}),
  });
  try {
    fs.appendFileSync(process.env.NANOCLAW_LEARNING_TRACE_FILE || FILE, line + '\n');
  } catch {
    /* best-effort */
  }
}

export function _resetLearningTraceForTesting(): void {
  enabled = null;
}
