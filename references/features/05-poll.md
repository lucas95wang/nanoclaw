# Stage 5 · Poll (the runner claims the message)

## What it is

Inside the container, `bun /app/src/index.ts` (`container/agent-runner/src/index.ts`) loads `/workspace/agent/container.json`, starts the mailbox from `/app/.nanoclaw-session.json`, scaffolds `memory/`, builds the system-prompt addendum (agent name + destinations), configures MCP (`nanoclaw` tools + the group's own), creates the provider and enters `runPollLoop` (`poll-loop.ts`).

The loop: every 1 s `getPendingMessages()` reads `messages_in` rows that are `pending` and not yet acked in `outbound.db.processing_ack`. A batch with no `trigger=1` row is left alone (accumulate contract). Otherwise `markProcessing(ids)` writes `processing_ack`, routing is extracted, `/clear` and `/upload-trace` are handled by the runner itself, pre-task scripts gate task rows, and the rest is rendered into an XML prompt (`<message … >` blocks, or raw text for native slash commands) by `formatMessagesWithCommands`.

The continuation (Claude session id) is read from `outbound.db.session_state['continuation:claude']`; `maybeRotateContinuation` starts fresh when the transcript is missing, > 12 MB or > 14 days old.

## How a user triggers it

Nothing to do: the container polls by itself once stage 4 started it. A `/clear` message resets the continuation without a model call.

## How an agent runs and verifies it

```
S=data/v2-sessions/<ag>/<sess>
pnpm exec tsx scripts/q.ts $S/outbound.db "select * from processing_ack"
pnpm exec tsx scripts/q.ts $S/outbound.db "select * from session_state"
```
Container stderr reaches the host log only with `LOG_LEVEL=debug` (`grep 'container=' logs/nanoclaw.log`). Learning trace: `poll:claimed` (ids, pollCount, continuation), `poll:prompt` (provider, resume, prompt text), `poll:completed`.

## Where it goes wrong

- A row stays `pending` forever: the container is not running (stage 4), or the batch has only `trigger=0` rows.
- A row stays `processing`: the model call hung; the host sweep resets it after `NANOCLAW_CLAIM_STUCK_MS` (60 s) if the heartbeat stops.
- 10 consecutive mailbox errors → the runner exits 75 so the host respawns it.
- Follow-up messages during a turn are pushed into the open query (`query.push`), not re-spawned; a slash command instead aborts the stream and is handled on the next loop.

## Version-specific

- `runPollLoop` ~line 84, `processQuery` ~355 (`container/agent-runner/src/poll-loop.ts`, 310f739b).
- Mailbox read path: `container/agent-runner/src/mailbox/sqlite/connection.ts` opens inbound read-only with `mmap_size=0` on every read (VirtioFS coherency).
