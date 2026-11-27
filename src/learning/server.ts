/**
 * Learning server — a tiny HTTP + SSE server on 127.0.0.1 that the learning
 * panel talks to. Started only from startLearning() (learning mode).
 *
 *   GET  /                      panel (learning/panel/dist, built by Vite)
 *   GET  /api/events            SSE: trace events, panel replies, status
 *   GET  /api/state             what is running: channels, agent groups, sessions, faults, CLI status
 *   GET  /api/nodes             learning/nodes.json (stages + mechanisms)
 *   GET  /api/traces            stored traces, newest first
 *   GET  /api/traces/:msgId     one message's events (replay)
 *   POST /api/chat {text}       inject a message through the learning-web channel
 *   GET  /api/features          names of references/features/*.md
 *   GET  /api/features/:name    one feature-map file (raw markdown)
 *   GET  /api/profile           parsed learner profile + progress summary
 *   POST /api/profile {update}  apply a ProfileUpdate and rewrite learner-profile.md
 *   POST /api/tutor {…}         ask the tutor (claude -p) with real trace context
 *   GET  /api/faults            active fault switches
 *   POST /api/faults {name,on}  set a fault for the troubleshooting drill
 */
import fs from 'fs';
import http from 'http';
import path from 'path';

import { getAllAgentGroups } from '../db/agent-groups.js';
import { getActiveSessions } from '../db/sessions.js';
import { getActiveAdapters } from '../channels/channel-registry.js';
import { onPanelReply, panelChannelReady, sendFromPanel } from '../channels/learning-web.js';
import { log } from '../log.js';
import { activeFaults, FAULT_NAMES, isFaultName, setFault } from './faults.js';
import { applyUpdate, loadNodes, progressSummary, readProfile, writeProfile, type ProfileUpdate } from './profile.js';
import { listTraces, readTrace, recentEvents, subscribe, trace, type TraceEvent } from './trace.js';
import { askTutor, claudeCliStatus, type TutorRequest } from './tutor.js';

export const DEFAULT_PORT = 7788;

type SseClient = http.ServerResponse;
const clients = new Set<SseClient>();
let server: http.Server | null = null;

function root(): string {
  return process.cwd();
}

function featuresDir(): string {
  return path.join(root(), 'references', 'features');
}

function panelDist(): string {
  return path.join(root(), 'learning', 'panel', 'dist');
}

function sendSse(res: SseClient, type: string, payload: unknown): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function broadcast(type: string, payload: unknown): void {
  for (const c of clients) {
    try {
      sendSse(c, type, payload);
      // eslint-disable-next-line no-catch-all/no-catch-all -- a dead client must not stop the broadcast
    } catch {
      clients.delete(c);
    }
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function serveStatic(urlPath: string, res: http.ServerResponse): boolean {
  const dist = panelDist();
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(dist, rel));
  if (!file.startsWith(dist)) return false;
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(dist, 'index.html');
  if (!fs.existsSync(target)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><meta charset="utf-8"><title>NanoClaw 学习面板</title><body style="font-family:system-ui;padding:32px;background:#0b0b0c;color:#e6e6e6"><h2>面板还没有构建</h2><p>在仓库里运行 <code>pnpm run learn:build</code>（或 <code>cd learning/panel && pnpm install && pnpm run build</code>），然后刷新。</p><p>API 已经在工作：<a style="color:#4f8cff" href="/api/state">/api/state</a></p></body>',
    );
    return true;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
  return true;
}

function safeFeatureName(name: string): string | null {
  return /^[A-Za-z0-9._-]+\.md$/.test(name) ? name : null;
}

async function stateSnapshot(): Promise<Record<string, unknown>> {
  const [groups, sessions] = await Promise.all([getAllAgentGroups(), getActiveSessions()]);
  return {
    learning: true,
    port: currentPort,
    startedAt: startedAt,
    channels: getActiveAdapters().map((a) => ({ name: a.name, channelType: a.channelType, connected: a.isConnected(), supportsThreads: a.supportsThreads })),
    panelChannelReady: panelChannelReady(),
    agentGroups: groups.map((g) => ({ id: g.id, name: g.name, folder: g.folder })),
    sessions: sessions.map((s) => ({ id: s.id, agentGroupId: s.agent_group_id, messagingGroupId: s.messaging_group_id, threadId: s.thread_id, containerStatus: s.container_status, lastActive: s.last_active })),
    faults: activeFaults(),
    faultNames: FAULT_NAMES,
    claudeCli: claudeCliStatus(),
    unavailable: {
      // Stages the panel must mark as "not observable here", with the real reason.
      whatsapp: 'WhatsApp 渠道没有安装（这次学习用终端 cli 和面板渠道）',
    },
  };
}

let currentPort = DEFAULT_PORT;
let startedAt = '';

/**
 * The server binds to 127.0.0.1, but a page in the learner's browser could
 * still reach it through DNS rebinding or a cross-site POST. Only the panel's
 * own origin may call the API: the Host must be this server, and a browser
 * request (one that carries an Origin) must come from that same host. Tools
 * like curl send no Origin and stay allowed.
 */
function originAllowed(req: http.IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  const ok = host === `127.0.0.1:${currentPort}` || host === `localhost:${currentPort}`;
  if (!ok) return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== `http://${host}`) return false;
  return true;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const p = url.pathname;
  if (!originAllowed(req)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden: the learning panel only answers its own origin');
    return;
  }
  try {
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      // Late joiners get the recent ring so an in-flight message is not lost.
      sendSse(res, 'hello', { recent: recentEvents().slice(-300), state: await stateSnapshot() });
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/state' && req.method === 'GET') return json(res, 200, await stateSnapshot());
    if (p === '/api/nodes' && req.method === 'GET') return json(res, 200, loadNodes(root()));
    if (p === '/api/traces' && req.method === 'GET') {
      return json(
        res,
        200,
        listTraces().map((t) => ({ msgId: t.msgId, mtimeMs: t.mtimeMs, first: t.first })),
      );
    }
    if (p.startsWith('/api/traces/') && req.method === 'GET') {
      return json(res, 200, readTrace(decodeURIComponent(p.slice('/api/traces/'.length))));
    }
    if (p === '/api/chat' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { text?: string };
      if (!body.text || typeof body.text !== 'string') return json(res, 400, { error: 'text required' });
      const msgId = await sendFromPanel(body.text);
      trace({ stage: 0, event: 'panel:sent', msgId, file: 'src/learning/server.ts', fn: 'handle /api/chat', data: { text: body.text }, side: 'panel' });
      return json(res, 200, { msgId });
    }
    if (p === '/api/features' && req.method === 'GET') {
      let names: string[] = [];
      try {
        names = fs.readdirSync(featuresDir()).filter((n) => n.endsWith('.md')).sort();
      } catch {
        names = [];
      }
      return json(res, 200, { dir: 'references/features', files: names });
    }
    if (p.startsWith('/api/features/') && req.method === 'GET') {
      const name = safeFeatureName(decodeURIComponent(p.slice('/api/features/'.length)));
      if (!name) return json(res, 400, { error: 'bad name' });
      try {
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(path.join(featuresDir(), name), 'utf-8'));
      } catch {
        json(res, 404, { error: 'not found', name });
      }
      return;
    }
    if (p === '/api/profile' && req.method === 'GET') {
      const nodes = loadNodes(root());
      const profile = readProfile(root());
      return json(res, 200, { profile, summary: progressSummary(profile, nodes) });
    }
    if (p === '/api/profile' && req.method === 'POST') {
      const update = JSON.parse((await readBody(req)) || '{}') as ProfileUpdate;
      const profile = applyUpdate(readProfile(root()), update);
      writeProfile(profile, root());
      broadcast('profile', { profile });
      return json(res, 200, { profile, summary: progressSummary(profile, loadNodes(root())) });
    }
    if (p === '/api/tutor' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as TutorRequest & { msgId?: string };
      if (!body.question) return json(res, 400, { error: 'question required' });
      const traceEvents: TraceEvent[] | undefined = body.trace ?? (body.msgId ? readTrace(body.msgId) : undefined);
      let featureText: string | null = null;
      const fname = body.feature ? safeFeatureName(body.feature) : null;
      if (fname) {
        try {
          featureText = fs.readFileSync(path.join(featuresDir(), fname), 'utf-8');
        } catch {
          featureText = null;
        }
      }
      const result = await askTutor({ ...body, trace: traceEvents, profile: body.profile ?? readProfile(root()) }, featureText);
      return json(res, result.ok ? 200 : 503, result);
    }
    if (p === '/api/faults' && req.method === 'GET') return json(res, 200, { active: activeFaults(), names: FAULT_NAMES });
    if (p === '/api/faults' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { name?: unknown; on?: unknown };
      if (!isFaultName(body.name)) return json(res, 400, { error: 'unknown fault', names: FAULT_NAMES });
      setFault(body.name, body.on !== false);
      trace({ stage: 0, event: `fault:${body.on !== false ? 'set' : 'clear'}`, file: 'src/learning/faults.ts', fn: 'setFault', data: { name: body.name }, side: 'panel' });
      broadcast('faults', { active: activeFaults() });
      return json(res, 200, { active: activeFaults() });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'no such route', path: p });
    if (req.method === 'GET' && serveStatic(p, res)) return;
    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    log.warn('learning server request failed', { path: p, err });
    if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

export function startLearningServer(port = DEFAULT_PORT): Promise<number> {
  currentPort = port;
  startedAt = new Date().toISOString();
  subscribe((event) => broadcast('trace', event));
  onPanelReply((reply) => {
    trace({ stage: 8, event: 'panel:reply', file: 'src/channels/learning-web.ts', fn: 'deliver', data: { text: reply.text, kind: reply.kind }, side: 'panel' });
    broadcast('reply', reply);
  });
  server = http.createServer((req, res) => void handle(req, res));
  return new Promise((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(port, '127.0.0.1', () => {
      log.info('learning server listening', { url: `http://127.0.0.1:${port}/` });
      resolve(port);
    });
  });
}

export function stopLearningServer(): Promise<void> {
  for (const c of clients) c.end();
  clients.clear();
  return new Promise((resolve) => {
    const srv = server;
    server = null;
    if (!srv) return resolve();
    // SSE clients reconnect at once, so close() alone could wait forever on
    // keep-alive sockets and hold up the host's graceful shutdown.
    const timer = setTimeout(() => resolve(), 1000);
    srv.close(() => {
      clearTimeout(timer);
      resolve();
    });
    srv.closeAllConnections();
  });
}
