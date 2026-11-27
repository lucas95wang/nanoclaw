# Mechanism · The two mailboxes (inbound.db / outbound.db)

## What it is

Host and container share no socket, pipe or stdin. Each session has two SQLite files in `data/v2-sessions/<ag>/<sess>/`, bind-mounted at `/workspace`:

| File | Writer | Reader | Tables |
|---|---|---|---|
| `inbound.db` | host | container (read-only connection) | `messages_in`, `delivered`, `destinations`, `session_routing` |
| `outbound.db` | container | host (read-only) | `messages_out`, `processing_ack`, `session_state`, `container_state` |

One writer per file means no cross-mount lock contention. Both use `journal_mode=DELETE`; WAL's shared-memory index does not propagate across the Docker VM file share, so a WAL reader would freeze on an old snapshot. Sequence numbers: host even, container odd. Ownership is mirrored: the host marks delivery in its own file (`delivered`), the container marks claims in its own (`processing_ack`); the sweep copies ack status into `messages_in.status`.

The seam is `src/mailbox/` (`AgentMailbox`, `MailboxSession`) with the SQLite realization in `src/mailbox/sqlite/`, mirrored for the runner in `container/agent-runner/src/mailbox/` (`model.generated.ts` is a copy checked by `pnpm run mailbox-model:check`).

## How a user triggers it

Every message. Nothing to configure.

## How an agent runs and verifies it

`pnpm exec tsx scripts/q.ts <path>.db "<sql>"` on either file. A healthy exchange shows one `messages_in` row (`completed`), one `processing_ack` (`completed`), one `messages_out` row, one `delivered` row.

## Where it goes wrong

- Host writing outbound.db while the container runs: lost writes (`writeOutboundDirect` is only used when no container runs).
- Deleting a session folder while running: the runner hits 10 mailbox errors and exits 75; the next message re-provisions.
- Opening the DBs with the `sqlite3` CLI in WAL mode breaks the contract; use `scripts/q.ts`.

## Version-specific

- Schema `src/mailbox/sqlite/schema.ts`; runner connection `container/agent-runner/src/mailbox/sqlite/connection.ts` (`mmap_size=0`, retry on torn reads) (310f739b).
