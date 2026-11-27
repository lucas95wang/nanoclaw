# NanoClaw 学习环境（learning 分支）

这个分支在官方 NanoClaw 上加了一层"观察层"和一个学习面板，用来看懂一条消息从进入系统到回复的完整路径。所有改动默认关闭：用官方方式启动（systemd / launchd 服务、`pnpm run dev`）时没有埋点、没有面板端口，行为和上游一致。

## 你需要提供什么，放在哪里

| 东西 | 放哪里 | 用途 |
|---|---|---|
| Claude 订阅（或 API key） | 安装向导里 `claude setup-token`，存进 OneCLI 保险库 | agent 容器调模型（经网关换上真凭证，容器里只有占位 token） |
| 本机 Claude Code CLI 的登录 | 在跑面板的那台机器上执行 `claude login`（或 `claude setup-token`） | 面板里的导师和两种考核打分用 `claude -p`；未登录时面板会标明"导师不可用"和原因，不用假数据 |
| 聊天渠道（可选） | `/add-telegram`、`/add-whatsapp` 等 skill | 这次学习只用官方内置的终端渠道 `cli` 和面板自己的 `learning-web` 渠道；没装的渠道会在 ① 上标明 |

## 部署过程中遇到的问题和解决办法

| 问题 | 解决 |
|---|---|
| Mac 上的 Node 25 不在官方支持列表（22 / 24 / 26） | 部署放进 UTM 里的 Ubuntu 24.04 虚拟机，由 `nanoclaw.sh` 自己装 Node 22 |
| 向导要在真实终端里跑（交互式提示、PTY 抓 token） | 在 VM 里用 tmux 跑 `bash nanoclaw.sh`，用 `tmux send-keys` 回答；登录链接复制到 Mac 浏览器完成 |
| 向导第二次 `claude setup-token`（给 Claude Code 自己用）不持久化 | `claude auth status` 仍是未登录；要在 VM 里再 `claude login` 一次 |
| 向导最后的验证步报 `failed` | 只是因为没接聊天软件、注册的 agent 组为 0；用 `scripts/init-cli-agent.ts` 接终端渠道后就正常 |
| 宿主被 `kill` 而不是 Ctrl-C 停掉后，新进程起容器报 `claimed by another live host` | 宿主租约没释放；要么等它过期，要么用 Ctrl-C 优雅退出。学习服务原本会让 Ctrl-C 卡住（SSE 长连接），已修 |
| 热容器（学习模式启动前就在跑）没有容器侧 trace | 面板在 ⑤ 上说明原因；`ncl groups restart --id <组>` 后下次 spawn 会带上开关 |
| 2026-11-27 两次观察到：宿主硬杀后新进程领养了旧容器，再 `ncl groups restart`，之后每条消息都停在路由之后（trace 到 `route:engage` 为止，没有 `inbox:session`），日志无报错 | 未确认根因（上游路径，不在学习改动里）。恢复：Ctrl-C 优雅退出再启动。不要在领养状态下 restart；端到端测试默认不再 restart（`E2E_RESTART=1` 才做） |
| 改了代码后服务拒绝启动（upgrade tripwire） | `pnpm exec tsx scripts/upgrade-state.ts set`，`learning/start.sh` 已包含这一步 |
| 用 `node … \| tee 文件` 跑宿主，Ctrl-C 时 tee 先死、宿主写日志遇到断管直接退出，被当成"非正常退出"，断路器把下次启动延迟到 15 分钟 | 不要用管道：`pnpm run learn` 直接跑在前台；要留日志就 `> 文件 2>&1`。测试机上可以删 `data/circuit-breaker.json` 清掉退避 |

## 启动方法

```
# 官方方式（埋点关闭）
systemctl --user start nanoclaw-v2-<slug>      # 或 pnpm run dev

# 学习模式（埋点 + 面板）
pnpm run learn
```

`pnpm run learn` 做的事：`pnpm run build`，没有面板构建就 `learn:build`，盖 upgrade-state 戳，接好 `learning-web` 渠道，停掉官方服务，以 `NANOCLAW_LEARNING=1` 在前台跑宿主，面板在 http://127.0.0.1:7788/ 。Ctrl-C 退出后自动把官方服务起回来。

在 VM 里跑、在 Mac 上看：`ssh -N -L 7788:127.0.0.1:7788 lucas@<vm-ip>` 后打开 http://127.0.0.1:7788/ （学习服务只认这个 Host）。

## 面板用法

- **实时**：发一条消息，8 个环节按真实顺序点亮，上方时间轴是真实耗时。点任意环节看它这一刻的数据、作用、文件:函数和 feature map。
- **单步**：切到单步再发消息。真实流程照常跑完，面板按你的猜测逐步揭示；猜错记进 `learning/learner-profile.md` 并安排两天后回考。
- **回放**：选一条旧消息（`data/learning/traces/<msgId>.jsonl`）一步步重走。
- **导师**：只回答关于当前这条消息的问题，会引用真实数据（时间、id、容器名）。
- **知识地图**：8 个环节 + 12 个机制，掌握度用亮和灰；点节点复习或考核。
- **考核**：复述（导师按环节打分）、情景题（按要点打分）、排障演练（真的弄坏一步：`wake-refused` 或 `route-denied`，你找原因，然后恢复并验证）。
- **减少动效**：右上开关，或系统的 prefers-reduced-motion。

## 建议的学习顺序

1. 实时模式发"普通聊天"，看完 8 步，点开 ③ 和 ⑦ 看双信箱，点开 ④ 看挂载表。
2. 单步模式发"要用工具"，每步先猜。
3. 发"定时提醒"，看 ⑦ 里的 `cli_request` 系统消息，再到知识地图读"定时任务"和"心跳与 sweep"。
4. 发 `/clear`，看它为什么不进 ⑥。
5. 知识地图里把灰的机制逐个读完（feature map 在 `references/features/`）。
6. 考核：先情景题，再复述，最后排障演练。
7. 第二次打开面板时读"上次学到哪里"，按建议回考。

## 文件在哪里

| 内容 | 位置 |
|---|---|
| 宿主观察层 | `src/learning/`（trace、server、container-trace、faults、profile、tutor） |
| 面板渠道 | `src/channels/learning-web.ts`（`channels/index.ts` 一行 import） |
| 埋点 | `src/index.ts`、`src/router.ts`、`src/session-manager.ts`、`src/container-runner.ts`、`src/delivery.ts`；容器侧 `container/agent-runner/src/learning-trace.ts` + `poll-loop.ts`、`providers/claude.ts`、`db/messages-out.ts` |
| 面板 | `learning/panel/`（Vite + React + React Flow） |
| feature map | `references/features/`（只描述系统，不含学习内容） |
| 学习档案、节点表 | `learning/learner-profile.md`、`learning/nodes.json` |
| 一键启动 / 端到端测试 | `learning/start.sh`、`learning/e2e/run.mjs`（`pnpm run learn:e2e`），skill `.claude/skills/learning-panel-check` |
| trace 数据 | `data/learning/traces/`（不进 git） |
