/**
 * Learner profile — learning/learner-profile.md is the single source of
 * truth for what the learner has mastered. The file is Markdown so it can be
 * read without the panel; this module parses the sections it owns and writes
 * them back in the same shape. Everything outside the learning module reads
 * nothing from here: the profile is learning-only data and lives outside
 * references/features/ on purpose.
 */
import fs from 'fs';
import path from 'path';

export type Level = '未接触' | '模糊' | '理解' | '能讲给别人听';
export const LEVELS: Level[] = ['未接触', '模糊', '理解', '能讲给别人听'];

export interface NodeDef {
  id: string;
  title: string;
  stage?: number;
  feature: string;
  group?: string;
  uses?: string[];
  file?: string;
  fn?: string;
}

export interface NodesFile {
  stages: NodeDef[];
  mechanisms: NodeDef[];
  levels: Level[];
}

export interface MasteryRow {
  id: string;
  title: string;
  level: Level;
  updated: string;
  note: string;
}

export interface Profile {
  updated: string;
  mastery: MasteryRow[];
  wrongGuesses: string[];
  repeatedQuestions: Record<string, number>;
  exams: string[];
  reviewDue: Record<string, string>;
  sessions: string[];
}

export function profilePath(root = process.cwd()): string {
  return path.join(root, 'learning', 'learner-profile.md');
}

export function nodesPath(root = process.cwd()): string {
  return path.join(root, 'learning', 'nodes.json');
}

export function loadNodes(root = process.cwd()): NodesFile {
  return JSON.parse(fs.readFileSync(nodesPath(root), 'utf-8')) as NodesFile;
}

export function allNodes(nodes: NodesFile): NodeDef[] {
  return [...nodes.stages, ...nodes.mechanisms];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyProfile(nodes: NodesFile): Profile {
  return {
    updated: today(),
    mastery: allNodes(nodes).map((n) => ({ id: n.id, title: n.title, level: '未接触', updated: '', note: '' })),
    wrongGuesses: [],
    repeatedQuestions: {},
    exams: [],
    reviewDue: {},
    sessions: [],
  };
}

function section(text: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return '';
  const start = m.index + m[0].length;
  const next = text.slice(start).search(/^## /m);
  return next < 0 ? text.slice(start) : text.slice(start, start + next);
}

function bullets(block: string): string[] {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
}

export function parseProfile(text: string, nodes: NodesFile): Profile {
  const profile = emptyProfile(nodes);
  const upd = /^更新时间：(.+)$/m.exec(text);
  if (upd) profile.updated = upd[1].trim();
  const byId = new Map(profile.mastery.map((r) => [r.id, r]));
  for (const line of section(text, '掌握程度').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6 || !cells[1] || cells[1] === '节点 id' || cells[1].startsWith('-')) continue;
    const row = byId.get(cells[1]);
    if (!row) continue;
    if (LEVELS.includes(cells[3] as Level)) row.level = cells[3] as Level;
    row.updated = cells[4] ?? '';
    row.note = cells[5] ?? '';
  }
  profile.wrongGuesses = bullets(section(text, '猜错的地方'));
  for (const b of bullets(section(text, '反复追问'))) {
    const m = /^(.*?)\s*×\s*(\d+)$/.exec(b);
    if (m) profile.repeatedQuestions[m[1]] = Number(m[2]);
    else profile.repeatedQuestions[b] = 1;
  }
  profile.exams = bullets(section(text, '考核记录'));
  for (const b of bullets(section(text, '待回考'))) {
    const m = /^(\S+)\s+(\d{4}-\d{2}-\d{2})/.exec(b);
    if (m) profile.reviewDue[m[1]] = m[2];
  }
  profile.sessions = bullets(section(text, '学习记录'));
  return profile;
}

export function renderProfile(p: Profile): string {
  const lines: string[] = [];
  lines.push('# 学习档案 learner-profile.md');
  lines.push('');
  lines.push('这个文件由学习面板维护，也可以手改。它只记学习过程，不描述 NanoClaw 本身（那在 references/features/）。');
  lines.push(`更新时间：${p.updated}`);
  lines.push('');
  lines.push('## 掌握程度');
  lines.push('');
  lines.push('程度分四级：未接触、模糊、理解、能讲给别人听。');
  lines.push('');
  lines.push('| 节点 id | 节点 | 程度 | 最近更新 | 备注 |');
  lines.push('|---|---|---|---|---|');
  for (const r of p.mastery) lines.push(`| ${r.id} | ${r.title} | ${r.level} | ${r.updated} | ${r.note} |`);
  lines.push('');
  lines.push('## 猜错的地方');
  lines.push('');
  lines.push(...(p.wrongGuesses.length ? p.wrongGuesses.map((g) => `- ${g}`) : ['（还没有）']));
  lines.push('');
  lines.push('## 反复追问');
  lines.push('');
  const rq = Object.entries(p.repeatedQuestions);
  lines.push(...(rq.length ? rq.map(([q, n]) => `- ${q} × ${n}`) : ['（还没有）']));
  lines.push('');
  lines.push('## 考核记录');
  lines.push('');
  lines.push(...(p.exams.length ? p.exams.map((e) => `- ${e}`) : ['（还没有）']));
  lines.push('');
  lines.push('## 待回考');
  lines.push('');
  const rd = Object.entries(p.reviewDue);
  lines.push(...(rd.length ? rd.map(([id, d]) => `- ${id} ${d}`) : ['（还没有）']));
  lines.push('');
  lines.push('## 学习记录');
  lines.push('');
  lines.push(...(p.sessions.length ? p.sessions.map((s) => `- ${s}`) : ['（还没有）']));
  lines.push('');
  return lines.join('\n');
}

export function readProfile(root = process.cwd()): Profile {
  const nodes = loadNodes(root);
  let text = '';
  try {
    text = fs.readFileSync(profilePath(root), 'utf-8');
  } catch {
    return emptyProfile(nodes);
  }
  return parseProfile(text, nodes);
}

export function writeProfile(p: Profile, root = process.cwd()): void {
  p.updated = today();
  fs.mkdirSync(path.dirname(profilePath(root)), { recursive: true });
  fs.writeFileSync(profilePath(root), renderProfile(p));
}

export interface ProfileUpdate {
  /** Set a node's level directly (quiz result, tutor judgement). */
  level?: { id: string; level: Level; note?: string };
  /** A step-mode guess: right or wrong, with the misconception when wrong. */
  guess?: { id: string; guessed: string; actual: string; correct: boolean; misconception?: string };
  /** A tutor question, counted so repeated topics surface. */
  question?: { id: string; topic: string };
  /** An exam outcome line. */
  exam?: { type: '复述' | '情景题' | '排障演练'; id: string; result: string; score?: number };
  /** Note a learning session (start/end summary). */
  session?: string;
  /** Schedule a re-test. */
  reviewDue?: { id: string; date: string };
}

function stampLevel(p: Profile, id: string, level: Level, note?: string): void {
  const row = p.mastery.find((r) => r.id === id);
  if (!row) return;
  row.level = level;
  row.updated = today();
  if (note !== undefined) row.note = note;
}

function bumpLevel(p: Profile, id: string, min: Level): void {
  const row = p.mastery.find((r) => r.id === id);
  if (!row) return;
  if (LEVELS.indexOf(min) > LEVELS.indexOf(row.level)) stampLevel(p, id, min);
}

function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function applyUpdate(p: Profile, u: ProfileUpdate): Profile {
  if (u.level) stampLevel(p, u.level.id, u.level.level, u.level.note);
  if (u.guess) {
    const g = u.guess;
    if (g.correct) {
      bumpLevel(p, g.id, '理解');
    } else {
      const row = p.mastery.find((r) => r.id === g.id);
      p.wrongGuesses.push(
        `${today()} ${g.id}${row ? ` ${row.title}` : ''}：猜"${g.guessed}"，实际"${g.actual}"${g.misconception ? `。误解：${g.misconception}` : ''}`,
      );
      if (row && row.level === '未接触') stampLevel(p, g.id, '模糊');
      p.reviewDue[g.id] = dateIn(2);
    }
  }
  if (u.question) {
    const key = `${u.question.id} ${u.question.topic}`;
    p.repeatedQuestions[key] = (p.repeatedQuestions[key] ?? 0) + 1;
    const row = p.mastery.find((r) => r.id === u.question!.id);
    if (row && row.level === '未接触') stampLevel(p, u.question.id, '模糊');
  }
  if (u.exam) {
    p.exams.push(`${today()} ${u.exam.type} ${u.exam.id}：${u.exam.result}${u.exam.score !== undefined ? `（${u.exam.score} 分）` : ''}`);
  }
  if (u.session) p.sessions.push(`${today()} ${u.session}`);
  if (u.reviewDue) p.reviewDue[u.reviewDue.id] = u.reviewDue.date;
  return p;
}

/** Two or three sentences for the panel's welcome: where we left off, what to do today. */
export function progressSummary(p: Profile, nodes: NodesFile): { lastSession: string | null; suggestion: string; counts: Record<Level, number> } {
  const counts: Record<Level, number> = { 未接触: 0, 模糊: 0, 理解: 0, 能讲给别人听: 0 };
  for (const r of p.mastery) counts[r.level]++;
  const due = Object.entries(p.reviewDue).filter(([, d]) => d <= today());
  const weakest = [...nodes.stages, ...nodes.mechanisms].find((n) => {
    const row = p.mastery.find((r) => r.id === n.id);
    return row && (row.level === '未接触' || row.level === '模糊');
  });
  let suggestion: string;
  if (due.length) {
    const row = p.mastery.find((r) => r.id === due[0][0]);
    suggestion = `先回考 ${row?.title ?? due[0][0]}（${due[0][1]} 到期），再往下学。`;
  } else if (weakest) {
    suggestion = `今天建议学 ${weakest.title}：发一条示例消息，在单步模式里走到它，猜一次，再向导师追问。`;
  } else {
    suggestion = '所有节点都到了"理解"以上。今天做一次完整复述，把它们提到"能讲给别人听"。';
  }
  return { lastSession: p.sessions.length ? p.sessions[p.sessions.length - 1] : null, suggestion, counts };
}
