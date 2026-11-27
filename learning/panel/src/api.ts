import type { NodesFile, Profile, ProfileSummary, StateSnapshot, TraceEvent, TraceListItem } from './types';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return (await res.json()) as T;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  state: () => fetch('/api/state').then((r) => j<StateSnapshot>(r)),
  nodes: () => fetch('/api/nodes').then((r) => j<NodesFile>(r)),
  traces: () => fetch('/api/traces').then((r) => j<TraceListItem[]>(r)),
  trace: (msgId: string) => fetch(`/api/traces/${encodeURIComponent(msgId)}`).then((r) => j<TraceEvent[]>(r)),
  chat: (text: string) => post('/api/chat', { text }).then((r) => j<{ msgId: string }>(r)),
  feature: async (name: string): Promise<string> => {
    const r = await fetch(`/api/features/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`feature ${name}: ${r.status}`);
    return r.text();
  },
  profile: () => fetch('/api/profile').then((r) => j<{ profile: Profile; summary: ProfileSummary }>(r)),
  profileUpdate: (update: unknown) => post('/api/profile', update).then((r) => j<{ profile: Profile; summary: ProfileSummary }>(r)),
  tutor: (body: unknown) =>
    post('/api/tutor', body).then(async (r) => {
      const data = (await r.json()) as { ok: boolean; answer?: string; error?: string; reason?: string; ms: number };
      return data;
    }),
  faults: () => fetch('/api/faults').then((r) => j<{ active: string[]; names: string[] }>(r)),
  setFault: (name: string, on: boolean) => post('/api/faults', { name, on }).then((r) => j<{ active: string[] }>(r)),
};

export interface SseHandlers {
  onHello?: (payload: { recent: TraceEvent[]; state: StateSnapshot }) => void;
  onTrace?: (event: TraceEvent) => void;
  onReply?: (reply: { id: string; kind: string; text: string | null; content: unknown; at: string }) => void;
  onProfile?: (payload: { profile: Profile }) => void;
  onFaults?: (payload: { active: string[] }) => void;
  onOpen?: () => void;
  onError?: () => void;
}

export function subscribeEvents(h: SseHandlers): () => void {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => h.onHello?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('trace', (e) => h.onTrace?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('reply', (e) => h.onReply?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('profile', (e) => h.onProfile?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('faults', (e) => h.onFaults?.(JSON.parse((e as MessageEvent).data)));
  es.onopen = () => h.onOpen?.();
  es.onerror = () => h.onError?.();
  return () => es.close();
}
