# Stage 7 · Outbox (the reply becomes a row in outbound.db)

## What it is

Replies leave the container only as rows in `outbound.db.messages_out`, written by `writeMessageOut()` (`container/agent-runner/src/db/messages-out.ts`). Three doors write them:

- The result door: `dispatchResultText()` parses `<message to="name">…</message>` blocks from the model's final text (and `deliverMidTurnBlocks()` for blocks completed mid-turn) and resolves `to` against the destinations map (`session_routing` + `destinations` in inbound.db).
- MCP tools: `send_message`, `send_file`, `ask_user_question`, `send_card` (`mcp-tools/core.ts`, `interactive.ts`) write rows directly, with `in_reply_to` from the current reply route.
- System rows: the container-side `ncl` writes `kind='system'` `cli_request` rows; task runs write `kind='task_log'`.

Each row carries `kind`, `channel_type`, `platform_id`, `thread_id`, `in_reply_to` (the namespaced inbound id), `seq` and JSON `content`. The container also writes `processing_ack(completed)` for the inbound ids when the turn ends; the host mirrors that into `messages_in.status`.

## How a user triggers it

Any reply. Ask the agent to "send me a file with …" to exercise `send_file` (files land in `outbox/<msgId>/` and are read by stage 8).

## How an agent runs and verifies it

```
pnpm exec tsx scripts/q.ts $S/outbound.db "select id,seq,in_reply_to,kind,channel_type,platform_id,substr(content,1,80) from messages_out order by seq desc limit 5"
```
`delivered` rows in inbound.db confirm the host picked them up (stage 8). Learning trace: `outbox:written` (outboundId, seq, kind, inReplyTo, content), `poll:completed`.

## Where it goes wrong

- Text not wrapped in `<message>`: nothing is written; the runner nudges the model to resend. Look for `Wrap-nudge pushed` in container stderr.
- Unknown destination name in `to=`: the block is dropped with a log line; check `destinations` in inbound.db.
- Task sessions never deliver final text: it goes to `groups/<folder>/tasks/<series>.md`; only `send_message` reaches a chat.
- Writing outbound.db from the host while a container runs loses writes across the Docker file share; the host never does this while `container_status != stopped`.

## Version-specific

- `writeMessageOut` ~line 94 (`db/messages-out.ts`), `dispatchResultText` ~1173, `deliverMidTurnBlocks` ~916 (`poll-loop.ts`, 310f739b). The learning branch made `writeMessageOut` async to trace after the write.
