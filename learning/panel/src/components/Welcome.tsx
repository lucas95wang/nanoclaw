import { useEffect, useState } from 'react';

import { api } from '../api';
import { useStore } from '../store';

export function Welcome() {
  const { s, dispatch, reloadProfile } = useStore();
  // Decided once when the overlay opens, before this visit is logged.
  const [first] = useState(() => !s.profile?.sessions.length);

  useEffect(() => {
    // Record that a learning session started, so the next visit can say "last time…".
    if (s.profile && !sessionStorage.getItem('nc-session-logged')) {
      sessionStorage.setItem('nc-session-logged', '1');
      api.profileUpdate({ session: `打开面板，掌握 ${s.profile.mastery.filter((m) => m.level === '理解' || m.level === '能讲给别人听').length}/${s.profile.mastery.length}` }).then(() => reloadProfile()).catch(() => undefined);
    }
  }, [s.profile, reloadProfile]);

  const close = () => {
    sessionStorage.setItem('nc-welcomed', '1');
    dispatch({ type: 'overlay', value: 'none' });
  };

  return (
    <div className="overlay" id="welcome">
      <div className="topbar"><div className="brand"><i />NanoClaw 学习面板</div><div className="status"><button className="btn sm" onClick={close} id="welcome-close">进入面板 ›</button></div></div>
      <div className="welcome scroll">
        <h1>{first ? '从这里开始' : '上次学到哪里'}</h1>
        {!first && s.summary && (
          <div className="card">
            <div><b>上次</b> <span className="muted">{s.summary.lastSession ?? s.profile?.sessions.slice(-1)[0]}</span></div>
            <div style={{ marginTop: 4 }}><b>现在</b> <span className="muted">能讲给别人听 {s.summary.counts['能讲给别人听']} · 理解 {s.summary.counts['理解']} · 模糊 {s.summary.counts['模糊']} · 未接触 {s.summary.counts['未接触']}</span></div>
            <div style={{ marginTop: 4 }}><b>今天建议</b> <span className="muted" id="today-suggestion">{s.summary.suggestion}</span></div>
          </div>
        )}
        {first && (
          <div className="card">
            <div><b>今天建议</b> <span className="muted" id="today-suggestion">{s.summary?.suggestion ?? '先发一条示例消息，看它走完 8 个环节。'}</span></div>
          </div>
        )}
        <ol>
          <li><b>看一遍真实流程。</b>左下点"普通聊天"，流程图上 8 个环节会按真实顺序点亮，上方时间轴显示每段耗时。</li>
          <li><b>点任意环节。</b>右栏显示它这一刻的真实数据（容器名、挂载、SQLite 行）、它做什么、为什么需要它，还有 feature map。</li>
          <li><b>切到"单步"再发一条。</b>每到一个环节先猜下一步会发生什么，再和真实结果对比。猜错会记进档案并安排回考。</li>
          <li><b>问导师。</b>右下的导师只回答"关于当前这条消息"的问题，会引用真实数据。{s.snapshot?.claudeCli && !s.snapshot.claudeCli.loggedIn ? <span className="errc">（现在本机 claude CLI 未登录，导师不可用：{s.snapshot.claudeCli.detail}）</span> : null}</li>
          <li><b>知识地图。</b>底部"知识地图"是全景：8 个环节加 12 个机制，掌握的点亮，没掌握的灰。点任何节点复习或考核。</li>
          <li><b>考核。</b>复述、情景题、排障演练三种。三种都过，并且每个节点都到"能讲给别人听"，知识地图就学完了。</li>
        </ol>
        <div className="muted">数据真实性：面板显示的每一个数字都来自宿主和容器的 trace；本机没有安装的渠道（WhatsApp 等）会在 ① 上标明，不用假数据。</div>
        <div><button className="btn pri" onClick={close} id="welcome-start">开始</button></div>
      </div>
      <div className="foot"><span>档案：learning/learner-profile.md</span></div>
    </div>
  );
}
