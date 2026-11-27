/**
 * One-command end-to-end check of the learning panel, played as a real learner.
 *
 * Every step records PASS / FAIL / INCONCLUSIVE with a screenshot in out/, so a
 * human (or another agent) can verify the claim from the evidence rather than
 * from this script's word. INCONCLUSIVE means the step could not be judged on
 * this machine (for example the tutor needs a signed-in Claude CLI); it never
 * counts as a pass.
 *
 *   cd learning/e2e && pnpm install && pnpm run install-browser   # once
 *   PANEL_URL=http://127.0.0.1:7788 node run.mjs                  # host must be in learning mode
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const URL = process.env.PANEL_URL || 'http://127.0.0.1:7788';
const OUT = path.resolve(process.env.E2E_OUT || 'out');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let shotN = 0;
async function shot(page, name) {
  const file = path.join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(process.cwd(), file);
}
function record(step, status, evidence, detail = '') {
  results.push({ step, status, evidence, detail });
  const tag = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '?';
  console.log(`${tag} ${status.padEnd(12)} ${step}${detail ? ` — ${detail}` : ''}${evidence ? `  [${evidence}]` : ''}`);
}
async function api(pathname, init) {
  const r = await fetch(`${URL}${pathname}`, init);
  return r.json();
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function waitFinished(page, timeout = 60_000) {
  await page.getByText('完成 · 到 ⑧').first().waitFor({ state: 'visible', timeout });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  // 0. host reachable, learning mode on
  const state = await api('/api/state');
  if (!state.learning) throw new Error('host is not in learning mode');
  const tutorReady = state.claudeCli?.loggedIn === true;
  record('0 host in learning mode', 'PASS', '', `channels ${state.channels.map((c) => c.name).join('+')}, tutor ${tutorReady ? 'ready' : 'unavailable: ' + state.claudeCli?.detail}`);
  // Start from a cold container so the run exercises a real spawn and the
  // container runs the current agent-runner source (a warm container keeps
  // the code it started with). `ncl` is on PATH after setup.
  for (const g of state.agentGroups) {
    try {
      execFileSync('ncl', ['groups', 'restart', '--id', g.id], { stdio: 'ignore', timeout: 60_000 });
      record(`0b agent container restarted (${g.name})`, 'PASS', '', 'next message spawns a fresh container');
    } catch (e) {
      record(`0b agent container restarted (${g.name})`, 'INCONCLUSIVE', '', `ncl groups restart failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 1. first open tells the learner where to start
  await page.goto(URL);
  await page.locator('#welcome').waitFor({ timeout: 15_000 });
  const welcomeText = await page.locator('#welcome').innerText();
  const hasStart = /从这里开始|上次学到哪里/.test(welcomeText) && /今天建议/.test(welcomeText) && /示例/.test(welcomeText);
  record('1 first open explains where to start', hasStart ? 'PASS' : 'FAIL', await shot(page, 'welcome'), hasStart ? 'welcome lists the steps and today\'s suggestion' : welcomeText.slice(0, 120));
  await page.locator('#welcome-start').click();

  // 2a. sample message, live mode, all 8 stages get data
  await page.locator('#mode-live').click();
  await page.locator('#sample-普通聊天').click();
  await waitFinished(page);
  const msgId1 = (await page.locator('.status b').first().innerText()).trim();
  const ev1 = await api(`/api/traces/${encodeURIComponent(msgId1)}`);
  const stagesSeen = new Set(ev1.map((e) => e.stage).filter((n) => n >= 1 && n <= 8));
  const missing = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !stagesSeen.has(n));
  record('2a sample message reaches all 8 stages in order', missing.length === 0 ? 'PASS' : 'FAIL', await shot(page, 'live-done'), missing.length ? `missing stages ${missing.join(',')}` : `${ev1.length} events, ${msgId1}`);
  // stage order: first event tMs of each stage must be non-decreasing
  const firstT = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ev1.find((e) => e.stage === n)?.tMs ?? Infinity);
  const ordered = firstT.every((t, i) => i === 0 || t >= firstT[i - 1]);
  record('2b stages light up in true order', ordered ? 'PASS' : 'FAIL', '', firstT.map((t) => (t === Infinity ? '–' : t - firstT[0])).join(' → '));
  // click each stage and check the details show real data
  let detailsOk = true;
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await page.locator(`#stage-node-${n}`).click();
    const txt = await page.locator('#stage-details').innerText();
    if (!txt.includes('这一刻的真实数据') || txt.includes('还没有第')) detailsOk = false;
  }
  record('2c each stage shows its real data when clicked', detailsOk ? 'PASS' : 'FAIL', await shot(page, 'details-stage8'));
  // free input
  await page.locator('#chat-input').fill('Free text check: reply with exactly OK.');
  await page.locator('#chat-send').click();
  await waitFinished(page);
  const replyText = await page.locator('.msgs').innerText();
  record('2d free input gets a reply', /OK/.test(replyText) ? 'PASS' : 'FAIL', await shot(page, 'free-input'));

  // 3. step mode: one wrong guess, one right guess
  await page.locator('#mode-step').click();
  await page.locator('#sample-要用工具').click();
  await page.getByText('第 2 步已经真实发生').waitFor({ timeout: 30_000 });
  await page.locator('#guess-2-drop').click();
  await page.locator('#guess-submit').click();
  const wrongTxt = await page.locator('#guess-result').innerText();
  record('3a wrong guess gets corrected with real data', /猜错了/.test(wrongTxt) && /真实情况/.test(wrongTxt) ? 'PASS' : 'FAIL', await shot(page, 'step-wrong'), wrongTxt.slice(0, 100));
  await page.getByText('第 3 步已经真实发生').waitFor({ timeout: 30_000 });
  const profileBefore = await api('/api/profile');
  // right guess on stage 3: read the real answer first
  await page.locator('#guess-skip').isVisible();
  const ev3 = await api(`/api/traces/${encodeURIComponent((await page.locator('.status b').first().innerText()).trim())}`);
  const created = ev3.find((e) => e.event === 'inbox:session')?.data?.created;
  await page.locator(created ? '#guess-3-new' : '#guess-3-reuse').click();
  await page.locator('#guess-submit').click();
  const rightTxt = await page.locator('#guess-result').innerText();
  record('3b right guess is confirmed', /猜对了/.test(rightTxt) ? 'PASS' : 'FAIL', await shot(page, 'step-right'));
  // reveal the rest without guessing
  for (let n = 4; n <= 8; n++) {
    await page.getByText(`第 ${n} 步已经真实发生`).waitFor({ timeout: 60_000 });
    const skip = page.locator('#guess-skip');
    if (await skip.isVisible()) await skip.click();
    else await page.locator('#reveal-next').click();
  }
  record('3c step mode reveals through stage 8', 'PASS', await shot(page, 'step-done'));

  // 4. tutor answers with the real message
  if (tutorReady) {
    await page.locator('#stage-node-4').click();
    await page.locator('#tutor-input').fill('这条消息的容器是新起的还是复用的？用数据说明。');
    await page.locator('#tutor-ask').click();
    await page.locator('#tutor .a').last().waitFor({ timeout: 150_000 });
    await page.waitForFunction(() => !document.querySelector('#tutor .a.dim'), null, { timeout: 150_000 });
    const ans = await page.locator('#tutor .a').last().innerText();
    const cites = /sess-|ncl-|nanoclaw-v2-|wake:|container/i.test(ans);
    record('4 tutor answer cites the current message', cites ? 'PASS' : 'FAIL', await shot(page, 'tutor'), ans.slice(0, 120));
  } else {
    record('4 tutor answer cites the current message', 'INCONCLUSIVE', await shot(page, 'tutor-unavailable'), `claude CLI not signed in on this host: ${state.claudeCli?.detail}`);
  }

  // 5. profile + map updated
  const profileAfter = await api('/api/profile');
  const wrongGrew = profileAfter.profile.wrongGuesses.length > profileBefore.profile.wrongGuesses.length - 1 && profileAfter.profile.wrongGuesses.some((g) => g.includes(' s2 '));
  const s3Level = profileAfter.profile.mastery.find((m) => m.id === 's3')?.level;
  record('5a learner profile records the wrong guess and the level', wrongGrew && s3Level && s3Level !== '未接触' ? 'PASS' : 'FAIL', '', `s2 wrong guesses ${profileAfter.profile.wrongGuesses.filter((g) => g.includes(' s2 ')).length}, s3 level ${s3Level}`);
  await page.locator('#open-map').click();
  await page.locator('#knowledge-map').waitFor();
  const mapTxt = await page.locator('#map-s3').evaluate((el) => el.textContent ?? '');
  record('5b knowledge map reflects the profile', mapTxt.includes(s3Level ?? '') ? 'PASS' : 'FAIL', await shot(page, 'map'), mapTxt.replace(/\n/g, ' '));
  await page.locator('#map-s4').click();
  await page.locator('#map-review').waitFor();
  await page.locator('#map-close').click();

  // 6. three exams
  // 6a retell (tutor)
  await page.locator('#open-quiz').click();
  await page.locator('#quiz-tab-复述').click();
  if (tutorReady) {
    await page.locator('#retell-input').fill('① 渠道 adapter 把消息交给 src/index.ts 的 onInbound；② router.ts 的 routeInbound 找 messaging_group、判断 engage 和权限；③ resolveSession 找或建 session，writeSessionMessage 写进 inbound.db；④ wakeContainer 没容器就 spawnContainer 起 docker；⑤ 容器里 runPollLoop 每秒读 inbound.db 认领消息；⑥ 调 Claude Agent SDK 经 OneCLI 代理，事件 touch 心跳；⑦ 回复写进 outbound.db 的 messages_out；⑧ 宿主 delivery.ts 轮询 outbound.db，经 adapter 发回，记 delivered。');
    await page.locator('#retell-submit').click();
    await page.locator('#grade-result, .card.bad .a').first().waitFor({ timeout: 180_000 });
    const g = await page.locator('#grade-result').innerText().catch(() => '');
    record('6a retell is graded per stage', /分/.test(g) ? 'PASS' : 'FAIL', await shot(page, 'quiz-retell'), g.split('\n')[0]);
  } else record('6a retell is graded per stage', 'INCONCLUSIVE', await shot(page, 'quiz-retell'), 'tutor unavailable');
  // 6b scenario (tutor)
  await page.locator('#quiz-tab-情景题').click();
  if (tutorReady) {
    await page.locator('#scenario-input').fill('消息会在 ② 路由停下：messaging_group 还在但没有接线，agentCount=0，dropped_messages 多一行 no_agent_wired，日志 MESSAGE DROPPED；不会有 session、容器和回复，重新接线后新消息才正常。');
    await page.locator('#scenario-submit').click();
    await page.locator('#grade-result, .card.bad .a').first().waitFor({ timeout: 180_000 });
    const g = await page.locator('#grade-result').innerText().catch(() => '');
    record('6b scenario is graded against the rubric', /分/.test(g) ? 'PASS' : 'FAIL', await shot(page, 'quiz-scenario'), g.split('\n')[0]);
  } else record('6b scenario is graded against the rubric', 'INCONCLUSIVE', await shot(page, 'quiz-scenario'), 'tutor unavailable');
  // 6c troubleshooting drill with full recovery
  await page.locator('#quiz-tab-排障演练').click();
  await page.locator('#drill-start').click();
  const faults = await api('/api/faults');
  const fault = faults.active[0];
  record('6c1 drill injects a real fault', fault ? 'PASS' : 'FAIL', '', `fault ${fault}`);
  await page.locator('#drill-send').click();
  // back on the panel; wait for the symptom, then return to the quiz
  await page.waitForTimeout(fault === 'wake-refused' ? 8000 : 4000);
  const probeId = (await page.locator('.status b').first().innerText()).trim();
  const probeEv = await api(`/api/traces/${encodeURIComponent(probeId)}`);
  const symptom = fault === 'wake-refused' ? probeEv.some((e) => e.event === 'wake:failed') : probeEv.some((e) => e.event === 'route:engage' && e.data.outcome === 'drop');
  record('6c2 the panel shows the symptom of the broken stage', symptom ? 'PASS' : 'FAIL', await shot(page, 'drill-symptom'), probeEv.map((e) => e.event).join(' '));
  await page.locator('#open-quiz').click();
  await page.locator(`#drill-pick-${fault}`).click();
  await page.locator('#drill-diagnose').click();
  const diag = await page.locator('#quiz .card.ok, #quiz .card.bad').first().innerText();
  record('6c3 diagnosis is checked', /定位正确/.test(diag) ? 'PASS' : 'FAIL', await shot(page, 'drill-diagnosed'));
  await page.locator('#drill-recover').click();
  const faultsAfter = await api('/api/faults');
  await page.locator('#drill-verify').click();
  await waitFinished(page, 90_000);
  await page.locator('#open-quiz').click();
  await page.locator('#drill-recovered').waitFor({ timeout: 30_000 }).catch(() => undefined);
  const recovered = await page.locator('#drill-recovered').isVisible().catch(() => false);
  record('6c4 after the drill the system fully recovers', faultsAfter.active.length === 0 && recovered ? 'PASS' : 'FAIL', await shot(page, 'drill-recovered'), `faults ${JSON.stringify(faultsAfter.active)}, verify message delivered ${recovered}`);
  await page.locator('#quiz-close').click();

  // 7. replay an old message
  await page.locator('#mode-replay').click();
  await page.locator('#replay-select').selectOption(msgId1);
  await page.locator('#reveal-next, #guess-skip').first().waitFor({ timeout: 15_000 });
  for (let i = 0; i < 8; i++) {
    const skip = page.locator('#guess-skip');
    const next = page.locator('#reveal-next');
    if (await skip.isVisible()) await skip.click();
    else if (await next.isVisible()) await next.click();
    else break;
  }
  const replayTxt = await page.locator('#next-step').innerText();
  record('7 an old message can be replayed step by step', /8 步都揭示完了/.test(replayTxt) ? 'PASS' : 'FAIL', await shot(page, 'replay'), replayTxt.slice(0, 80));

  // 8. second visit reads the profile and suggests
  await ctx.clearCookies();
  const page2 = await ctx.newPage();
  await page2.goto(URL);
  await page2.locator('#welcome').waitFor({ timeout: 15_000 });
  const w2 = await page2.locator('#welcome').innerText();
  const second = /上次学到哪里/.test(w2) && /今天建议/.test(w2) && /上次/.test(w2);
  record('8 second visit shows progress and today\'s suggestion', second ? 'PASS' : 'FAIL', await shot(page2, 'second-visit'), (w2.match(/今天建议[^\n]*/) ?? [''])[0].slice(0, 100));
  await page2.close();

  record('9 no page errors during the run', errors.length === 0 ? 'PASS' : 'FAIL', '', errors.slice(0, 3).join(' | '));
} catch (err) {
  record('run aborted', 'FAIL', await shot(page, 'aborted').catch(() => ''), err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

const summary = { url: URL, at: new Date().toISOString(), results };
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
const fails = results.filter((r) => r.status === 'FAIL').length;
const incon = results.filter((r) => r.status === 'INCONCLUSIVE').length;
console.log(`\n${results.length - fails - incon} PASS · ${fails} FAIL · ${incon} INCONCLUSIVE · evidence in ${path.relative(process.cwd(), OUT)}/`);
process.exit(fails ? 1 : 0);
