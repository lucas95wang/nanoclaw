# NanoClaw feature map

A map of what NanoClaw does, written for an agent that has to develop against it or verify it without a human explaining the system. Each file answers four questions: what it is, how a user triggers it, how an agent runs and verifies it, where it goes wrong. Each file ends with a **Version-specific** section (line numbers, constants, this install's values) that is expected to drift; everything above it is the stable contract. The learning panel renders these same files, so they are the single source of truth.

This describes the system only. Learning material (learner profile, quizzes, tutor prompts) lives in `learning/`, not here.

## The message path (one message, eight stages)

```
channel ──▶ [1 receive] ──▶ [2 route] ──▶ [3 inbox: inbound.db] ──▶ [4 wake container]
                                                                           │ container boundary
   [8 deliver] ◀── outbound.db ◀── [7 outbox] ◀── [6 model turn] ◀── [5 poll] ◀─┘
```

| # | File | One line |
|---|---|---|
| 1 | [01-receive.md](01-receive.md) | A channel adapter hands one `InboundMessage` to `onInbound` in `src/index.ts`. |
| 2 | [02-route.md](02-route.md) | `routeInbound` finds the chat, fans out to wired agents, applies gates. |
| 3 | [03-inbox.md](03-inbox.md) | `resolveSession` + `writeSessionMessage` → a row in the session's `inbound.db`. |
| 4 | [04-wake.md](04-wake.md) | `wakeContainer` → `spawnContainer`: compose CLAUDE.md, mounts, gateway lease, `docker create/start`. |
| 5 | [05-poll.md](05-poll.md) | The runner claims pending rows and builds the prompt. |
| 6 | [06-model.md](06-model.md) | Claude Agent SDK through OneCLI; events, tools, heartbeat. |
| 7 | [07-outbox.md](07-outbox.md) | Replies become rows in `outbound.db`. |
| 8 | [08-deliver.md](08-deliver.md) | The host polls `outbound.db` and sends through the adapter. |

## Mechanisms around the path

| File | One line |
|---|---|
| [m-sweep.md](m-sweep.md) | Heartbeat file + 60 s sweep: stuck detection, due wakes, recurrence. |
| [m-tasks.md](m-tasks.md) | Scheduled tasks are `kind=task` rows in a system session; `ncl tasks`. |
| [m-memory.md](m-memory.md) | Persona, composed CLAUDE.md, `memory/`, continuation and compaction. |
| [m-mailbox.md](m-mailbox.md) | Two SQLite files per session, one writer each, `journal_mode=DELETE`. |
| [m-channels.md](m-channels.md) | Entity model, adapters, wiring, isolation levels. |
| [m-isolation.md](m-isolation.md) | Docker hardening, mount classes, allowlist, egress lockdown. |
| [m-gateway.md](m-gateway.md) | OneCLI credential gateway: the key never enters the container. |
| [m-approvals.md](m-approvals.md) | `guard()` allow/hold/deny, approval cards, gateway approvals. |
| [m-centraldb.md](m-centraldb.md) | `data/v2.db` tables and how to query them. |
| [m-ncl.md](m-ncl.md) | Admin CLI over a socket (host) or mailbox rows (container). |
| [m-logs.md](m-logs.md) | Where logs go; diagnosis order. |
| [m-setup.md](m-setup.md) | Wizard steps, service, tripwire, upgrades. |
| [customizing.md](customizing.md) | Generic vs version-specific parts; adapting this map to a customised fork. |

## Regression order (end to end)

Run top to bottom; each step's evidence is in the linked file.

1. **Host up.** Service running, one process, `NanoClaw running` in the log (m-logs, m-setup).
2. **Gateway healthy.** `onecli` containers healthy, credential registered (m-gateway).
3. **Wiring present.** `ncl wirings list` shows a terminal (`cli/local`) wiring (m-channels).
4. **Stage 1–3.** `pnpm run chat "hello"`; `Message routed` in the log; a `messages_in` row with `trigger=1` (01, 02, 03).
5. **Stage 4.** `Spawning session`; `docker ps` shows the container; `.heartbeat` appears (04, m-isolation).
6. **Stage 5–7.** `processing_ack` completed; `session_state` has a continuation; a `messages_out` row (05, 06, 07, m-mailbox).
7. **Stage 8.** `Message delivered`; `delivered` row; the reply printed (08).
8. **Tool use.** Ask for a shell command; a `model:tool` trace / `container_state` row during the turn (06).
9. **Scheduling.** "Remind me in 2 minutes …"; `ncl tasks list` shows the row; it fires within 60 s of `process_after` and writes the run log (m-tasks, m-sweep).
10. **Memory.** "Remember X"; `memory/index.md` changes; a new message after `/clear` still knows X (m-memory).
11. **Approval.** Ask the agent to install a package; an approval card arrives for the owner (m-approvals).
12. **Idle reclaim.** After ~30 min idle the container is stopped by the ceiling rule (m-sweep).
13. **Learning mode off.** Start the service normally and repeat step 4–7: no `data/learning` writes, no `/api` port, identical behaviour (customizing).

## Conventions

- `$S` means `data/v2-sessions/<agent_group_id>/<session_id>`; find both with `ncl sessions list`.
- SQL goes through `pnpm exec tsx scripts/q.ts <db> "<sql>"`; string literals inside the SQL use single quotes (`where kind = 'task'`), the tool rejects double-quoted literals.
- "Learning trace" lines refer to events only present with `NANOCLAW_LEARNING=1` (`pnpm run learn`); every claim is also verifiable without it through the log or DB queries listed.
