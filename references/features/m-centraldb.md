# Mechanism · Central database (data/v2.db)

## What it is

Everything that is not per-session lives in one SQLite file, `data/v2.db`, accessed through the `DbDriver` seam (`src/db/`); migrations in `src/db/migrations/` run at startup (`runMigrations(db, undefined, { mode: 'auto' })`). Core tables: `agent_groups`, `messaging_groups`, `messaging_group_agents`, `users`, `user_roles`, `agent_group_members`, `user_dms`, `sessions`, `container_configs`, `pending_questions`, `pending_approvals`, `agent_destinations`, `agent_message_policies`, `unregistered_senders`, `pending_sender_approvals`, `pending_channel_approvals`, `dropped_messages`, `host_instances`, `session_claims`, `delivery_attempts`, `wake_signals`, `chat_sdk_*`, `schema_version`.

Only the host process writes it. Scripts and skills use `pnpm exec tsx scripts/q.ts data/v2.db "<sql>"` (same driver, `sqlite3 -list` style output) rather than the `sqlite3` CLI.

## How a user triggers it

Indirectly through `ncl` (groups, messaging-groups, wirings, users, roles, members, destinations, sessions, tasks) and the setup wizard.

## How an agent runs and verifies it

- `pnpm exec tsx scripts/q.ts data/v2.db "select name from sqlite_master where type='table' order by 1"`.
- `pnpm exec tsx scripts/q.ts data/v2.db "select * from schema_version"`.
- `ncl <resource> list`.

## Where it goes wrong

- Two hosts on one DB: `host_instances` and `session_claims` fence them, but sockets still collide (see stage 1).
- Hand-edited rows without CHECK constraints (e.g. an unknown `engage_mode`) make the router fail closed with a warning.
- Deleting `data/` resets the install (groups, wirings, sessions); `groups/` keeps memory and persona.

## Version-specific

- `CENTRAL_DB_PATH` in `src/config.ts`; migration ledger `src/db/migrations/index.ts`; `docs/db-central.md` (310f739b).
