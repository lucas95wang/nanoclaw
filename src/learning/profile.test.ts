import { describe, expect, it } from 'vitest';

import { applyUpdate, emptyProfile, parseProfile, progressSummary, renderProfile, type NodesFile } from './profile.js';

const nodes: NodesFile = {
  stages: [
    { id: 's1', stage: 1, title: '渠道接收', feature: '01-receive.md' },
    { id: 's4', stage: 4, title: '唤醒容器', feature: '04-wake.md' },
  ],
  mechanisms: [{ id: 'm-sweep', title: '心跳与 sweep', feature: 'm-sweep.md' }],
  levels: ['未接触', '模糊', '理解', '能讲给别人听'],
};

describe('learner profile', () => {
  it('round-trips through markdown', () => {
    const p = emptyProfile(nodes);
    p.mastery[0].level = '理解';
    p.mastery[0].note = '第一次就答对';
    p.wrongGuesses.push('2026-11-27 s4 唤醒容器：猜"复用容器"，实际"spawn"');
    p.repeatedQuestions['s4 CLAUDE.md 为什么重拼'] = 2;
    p.exams.push('2026-11-27 情景题 q2：通过（80 分）');
    p.reviewDue['s4'] = '2026-11-29';
    const text = renderProfile(p);
    const back = parseProfile(text, nodes);
    expect(back.mastery[0].level).toBe('理解');
    expect(back.mastery[0].note).toBe('第一次就答对');
    expect(back.wrongGuesses).toHaveLength(1);
    expect(back.repeatedQuestions['s4 CLAUDE.md 为什么重拼']).toBe(2);
    expect(back.exams[0]).toContain('情景题');
    expect(back.reviewDue.s4).toBe('2026-11-29');
  });

  it('records a wrong guess as a misconception, bumps the level and schedules a re-test', () => {
    const p = applyUpdate(emptyProfile(nodes), {
      guess: { id: 's4', guessed: '复用容器', actual: 'spawn', correct: false, misconception: '把 session 当成常驻进程' },
    });
    expect(p.wrongGuesses[0]).toContain('误解：把 session 当成常驻进程');
    expect(p.mastery.find((m) => m.id === 's4')?.level).toBe('模糊');
    expect(p.reviewDue.s4).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('suggests the weakest node when nothing is due', () => {
    const p = applyUpdate(emptyProfile(nodes), { level: { id: 's1', level: '能讲给别人听' } });
    const s = progressSummary(p, nodes);
    expect(s.suggestion).toContain('唤醒容器');
    expect(s.counts['能讲给别人听']).toBe(1);
  });
});
