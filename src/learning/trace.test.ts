import { afterEach, describe, expect, it, vi } from 'vitest';

import { _resetTraceForTesting, baseMessageId, emit, isLearning, redact, subscribe, trace } from './trace.js';

describe('learning trace', () => {
  afterEach(() => _resetTraceForTesting());

  it('is off unless NANOCLAW_LEARNING=1 (the official start path)', () => {
    expect(isLearning()).toBe(false);
    const seen: unknown[] = [];
    subscribe((e) => seen.push(e));
    trace({ stage: 1, event: 'inbound', msgId: 'm1', file: 'f', fn: 'g' });
    expect(seen).toHaveLength(0);
  });

  it('maps a namespaced message id back to the platform id', () => {
    expect(baseMessageId('cli-1-abc:ag-1795747215891-xaku3p')).toBe('cli-1-abc');
    expect(baseMessageId('web-1-abc')).toBe('web-1-abc');
    expect(baseMessageId(null)).toBeNull();
  });

  it('redacts secret-shaped values and truncates long text', () => {
    const out = redact({
      token: 'sk-ant-oat01-abcdefghijklmnop',
      note: 'bearer sk-ant-api03-zzzzzzzzzzzzzzzz ok',
      long: 'x'.repeat(1000),
      nested: { apiKey: 'secret-value' },
    }) as Record<string, unknown>;
    expect(out.token).toBe('(masked)');
    expect(String(out.note)).not.toContain('zzzzzzzz');
    expect(String(out.long).length).toBeLessThan(450);
    expect((out.nested as Record<string, unknown>).apiKey).toBe('(masked)');
  });

  it('emit() stamps seq, side and a base message id', () => {
    const e = emit({ stage: 6, event: 'model:init', msgId: 'cli-9:ag-1', sessionId: 'sess-1', file: 'f', fn: 'g', side: 'container' });
    expect(e.msgId).toBe('cli-9');
    expect(e.seq).toBe(1);
    expect(e.side).toBe('container');
  });

  it('in learning mode, container events inherit the message last written to their session', async () => {
    vi.resetModules();
    vi.stubEnv('NANOCLAW_LEARNING', '1');
    try {
      const live = await import('./trace.js');
      expect(live.isLearning()).toBe(true);
      live.rememberSessionMessage('sess-1', 'cli-9:ag-1');
      const e = live.emit({ stage: 6, event: 'model:init', sessionId: 'sess-1', file: 'f', fn: 'g', side: 'container' });
      expect(e.msgId).toBe('cli-9');
      live._resetTraceForTesting();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
