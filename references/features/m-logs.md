# Mechanism · Logs and troubleshooting

## What it is

Host logging is `src/log.ts`: one coloured line per event, `LOG_LEVEL` (default `info`), warn and above to stderr, the rest to stdout. Under the service, stdout → `logs/nanoclaw.log`, stderr → `logs/nanoclaw.error.log` (launchd plist / systemd unit written by `setup/service.ts`). `pnpm run dev` and learning mode (`pnpm run learn`) print to the terminal only: while learning mode runs, `logs/nanoclaw.log` stops at the service's last line, so read the terminal (or whatever file you tee it into).

Container output: the host supervises `docker start --attach`; each stderr line is logged at debug level with `container=<name>`, the last 10 lines are kept and printed as `Container exited non-zero … stderrTail` on failure. Containers are `--rm`, so nothing survives exit. The runner itself logs `[agent-runner]`, `[poll-loop]`, `[claude-provider]` prefixes.

Setup logs: `logs/setup.log` (one block per step) and `logs/setup-steps/NN-step.log` (raw). Learning mode adds `data/learning/traces/<msgId>.jsonl` with every stage event for every message.

## How a user triggers it

`tail -f logs/nanoclaw.log`; `LOG_LEVEL=debug` in the service definition for container lines; `/debug` skill in Claude Code.

## How an agent runs and verifies it

Diagnosis order (from `.claude/skills/debug/SKILL.md`):
1. `logs/nanoclaw.error.log` tail.
2. Single host? `ps aux | grep dist/index.js`; `systemctl --user status nanoclaw-v2-<slug>`.
3. Docker up? `docker info`; image present? `docker images | grep nanoclaw-agent`.
4. Gateway healthy? `docker ps | grep onecli`.
5. Wiring and routing? `ncl wirings list`; `grep "Message routed" logs/nanoclaw.log`, else `grep "MESSAGE DROPPED"` and `pnpm exec tsx scripts/q.ts data/v2.db "select reason, platform_id, created_at from dropped_messages order by created_at desc limit 5"`.
6. Session DBs: `scripts/q.ts` on inbound (`messages_in` status, `delivered`) and outbound (`messages_out`, `processing_ack`).
7. Heartbeat mtime vs now.
8. Delivery: `grep -E "Message delivered|Message delivery failed|No adapter for channel type|unknown messaging group" logs/nanoclaw.log`.

## Where it goes wrong

- `warn` lines also land in the error log; not every line there is an error.
- Adopted containers (after a host restart) have no attached stream, so no container lines until the next spawn.
- `Upgrade tripwire` messages at startup mean the checkout was changed outside `/update-nanoclaw`: stamp with `pnpm exec tsx scripts/upgrade-state.ts set` when the change is intentional.
- `Previous startup was not a clean shutdown` + `Circuit breaker: delaying startup`: the host was killed rather than stopped; each unclean stop within an hour raises the delay (0/0/10/30/120/300/900 s). Only a clean stop (SIGTERM/SIGINT) resets it.

## Version-specific

- `src/log.ts`, `setup/service.ts` (`renderLaunchdPlist` ~352, `renderSystemdUnit` ~554), `src/circuit-breaker.ts` (startup backoff 0/0/10/30/120/300/900 s) (310f739b).
