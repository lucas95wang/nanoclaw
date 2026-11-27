/**
 * Tutor — answers through the local Claude Code CLI (`claude -p`), so no API
 * key is needed beyond the subscription already signed in on this machine.
 *
 * Every call is stateless; the context that makes an answer specific is
 * assembled here: the real trace of the current message, the feature-map file
 * of the stage in question, and the learner profile. The CLI runs in an empty
 * working directory so repo instructions (CLAUDE.md, skills) do not leak in.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { learningDir, type TraceEvent } from './trace.js';
import type { Profile } from './profile.js';

export interface TutorRequest {
  question: string;
  mode?: 'tutor' | 'grade-retell' | 'grade-scenario' | 'grade-drill';
  stageId?: string;
  stageTitle?: string;
  feature?: string;
  trace?: TraceEvent[];
  profile?: Profile;
  rubric?: string;
  learnerAnswer?: string;
}

export interface TutorResult {
  ok: boolean;
  answer?: string;
  error?: string;
  reason?: string;
  ms: number;
}

const SYSTEM_PROMPT = `你是 NanoClaw 源码的导师。学习者看得懂代码，但不想陷入细节。
规则：
- 用通俗中文，短句，先讲整体和原理，再给关键代码位置（文件:函数）。不要大段贴代码。
- 回答必须结合给你的"当前这条消息的真实 trace 数据"：引用其中的字段值（时间、id、容器名、路径）来说明，不要泛泛而谈。
- 如果 trace 里没有相关数据，明说"这条消息里没有这一步的数据"，不要编。
- 学习者问题里有不对的前提时，先说"对 / 对一半 / 不对"，指出哪里不对，再回答。
- 一次只引入一两个新概念。
- 如果是打分模式（grade-*），按给定的要点逐条判断，输出 JSON：{"score":0-100,"pass":true|false,"perPoint":[{"point":"…","hit":true|false,"comment":"…"}],"level":"未接触|模糊|理解|能讲给别人听","feedback":"…"}，不要输出 JSON 以外的内容。`;

export function claudeCliStatus(): { available: boolean; loggedIn: boolean; detail: string } {
  const res = spawnSyncSafe('claude', ['auth', 'status'], 8000);
  if (res === null) return { available: false, loggedIn: false, detail: 'claude CLI not found on PATH' };
  try {
    const parsed = JSON.parse(res) as { loggedIn?: boolean; email?: string; authMethod?: string };
    return {
      available: true,
      loggedIn: parsed.loggedIn === true,
      detail: parsed.loggedIn ? `signed in (${parsed.email ?? parsed.authMethod ?? 'ok'})` : 'claude CLI is not signed in: run `claude login` (or `claude setup-token`) in the VM',
    };
  } catch {
    return { available: true, loggedIn: false, detail: `unexpected auth status output: ${res.slice(0, 120)}` };
  }
}

function spawnSyncSafe(cmd: string, args: string[], timeoutMs: number): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', timeout: timeoutMs, env: { ...process.env } });
  if (r.error) return null;
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

function cwdForTutor(): string {
  const dir = path.join(learningDir(), 'tutor-cwd');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function compactTrace(events: TraceEvent[] | undefined): string {
  if (!events?.length) return '（没有 trace 数据）';
  const t0 = events[0].tMs;
  return events
    .map((e) => `+${String(e.tMs - t0).padStart(6)}ms [${e.side}] 阶段${e.stage} ${e.event} ${e.file}:${e.fn} ${JSON.stringify(e.data).slice(0, 600)}`)
    .join('\n');
}

export function buildPrompt(req: TutorRequest, featureText: string | null): string {
  const parts: string[] = [];
  parts.push(`模式：${req.mode ?? 'tutor'}`);
  if (req.stageTitle) parts.push(`当前环节：${req.stageId ?? ''} ${req.stageTitle}`);
  parts.push(`\n## 当前这条消息的真实 trace\n${compactTrace(req.trace)}`);
  if (featureText) parts.push(`\n## 这个环节的 feature map（references/features/${req.feature ?? ''}）\n${featureText.slice(0, 12000)}`);
  if (req.profile) {
    const weak = req.profile.mastery.filter((m) => m.level === '未接触' || m.level === '模糊').map((m) => `${m.id} ${m.title}（${m.level}）`);
    parts.push(`\n## 学习档案摘要\n薄弱节点：${weak.join('、') || '无'}\n猜错过：${req.profile.wrongGuesses.slice(-5).join('；') || '无'}`);
  }
  if (req.rubric) parts.push(`\n## 打分要点\n${req.rubric}`);
  if (req.learnerAnswer) parts.push(`\n## 学习者的回答\n${req.learnerAnswer}`);
  parts.push(`\n## 学习者的问题\n${req.question}`);
  return parts.join('\n');
}

export function askTutor(req: TutorRequest, featureText: string | null, timeoutMs = 120_000): Promise<TutorResult> {
  const started = Date.now();
  const status = claudeCliStatus();
  if (!status.available || !status.loggedIn) {
    return Promise.resolve({ ok: false, error: 'claude-cli-unavailable', reason: status.detail, ms: Date.now() - started });
  }
  const prompt = buildPrompt(req, featureText);
  return new Promise((resolve) => {
    const child = spawn(
      'claude',
      ['-p', '--output-format', 'text', '--system-prompt', SYSTEM_PROMPT, '--tools', '', '--setting-sources', '', '--model', 'sonnet'],
      { cwd: cwdForTutor(), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'timeout', reason: `claude -p did not answer within ${timeoutMs / 1000}s`, ms: Date.now() - started });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'spawn-failed', reason: e.message, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve({ ok: true, answer: out.trim(), ms: Date.now() - started });
      else resolve({ ok: false, error: `exit-${code}`, reason: (err || out).trim().slice(0, 500), ms: Date.now() - started });
    });
    child.stdin.end(prompt);
  });
}
