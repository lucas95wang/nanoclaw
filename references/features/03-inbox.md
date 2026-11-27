# Stage 3 · Session and inbox (find the session, write inbound.db)

## What it is

`resolveSession(agentGroupId, messagingGroupId, threadId, sessionMode)` in `src/session-manager.ts` finds or creates the `sessions` row for this (agent, chat, thread) and the on-disk session folder `data/v2-sessions/<agent_group_id>/<session_id>/`. Session modes: `shared` (one per chat), `per-thread`, `agent-shared` (one per agent across chats).

`writeSessionMessage(...)` then inserts the message into that session's `inbound.db` table `messages_in` (id namespaced `<id>:<agentGroupId>`, `trigger=1` for a message that should wake the agent, `trigger=0` for silent context), extracts base64 attachments into `inbox/<msgId>/`, updates `sessions.last_active`, and enqueues a reconcile. Before the write, the router may add cross-session backfill rows and wake-context rows (both `trigger=0`).

Two SQLite files per session, one writer each: the host writes `inbound.db`, the container writes `outbound.db`. Both use `journal_mode=DELETE` (WAL does not propagate across the Docker file share).

## How a user triggers it

Any engaged message. `ncl sessions list` shows sessions; `ncl groups config update --session-mode …` is not a thing: session mode is a wiring property (`ncl wirings update`).

## How an agent runs and verifies it

```
S=data/v2-sessions/<ag>/<sess>
pnpm exec tsx scripts/q.ts $S/inbound.db "select id,kind,trigger,status,timestamp from messages_in order by rowid desc limit 5"
pnpm exec tsx scripts/q.ts $S/inbound.db "select * from session_routing"
```
`status` is `pending` until the container acks it (`processing_ack` in outbound.db, mirrored back by the host sweep). Learning trace: `inbox:session` (created?, sessionMode, containerStatus) and `inbox:written` (sessionDir, trigger).

## Where it goes wrong

- A deleted session folder with a surviving `sessions` row: `writeSessionMessage` re-provisions (`initSessionFolder` is idempotent), so this heals itself.
- Attachments with unsafe names are renamed; unsafe message ids are refused (`AnchoredDir` guards against symlink escapes).
- Nested mailbox sessions on the same key deadlock by design; never call `writeSessionMessage` inside `withMailboxSession`.
- `trigger=0` rows never wake the container; if a message "disappears", check its trigger value.

## Version-specific

- Paths: `src/mailbox/sqlite/paths.ts` (`inboundDbPath`, `outboundDbPath`), schema `src/mailbox/sqlite/schema.ts`.
- Host-owned runner context: `data/v2-sessions/<ag>/.context/<sess>.json` (0600), mounted read-only at `/app/.nanoclaw-session.json`.
