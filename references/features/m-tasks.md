# Mechanism · Scheduled tasks

## What it is

A task is a `messages_in` row with `kind='task'` in a dedicated system session (`thread_id = system:tasks:<seriesId>`, no messaging group). Fields: `process_after` (next run), `recurrence` (cron), `series_id`, `content` = `{prompt, script?, originSessionId}`. There is no separate tasks table.

Creation path: the agent runs `ncl tasks create --name … --recurrence "0 9 * * *" --prompt …` in Bash (instructions in `mcp-tools/scheduling.instructions.md`, composed into CLAUDE.md). The container-side `ncl` writes a `cli_request` system row to outbound.db; the host's delivery loop dispatches it (`src/cli/delivery-action.ts` → `src/cli/dispatch.ts` → `src/cli/resources/tasks.ts` → `src/modules/scheduling/create.ts`), which validates the cron, computes the first run in the group's timezone, creates the task session (`resolveTaskSession`) and inserts the row. The reply comes back as a `cli_response` row (trigger=0) that the container-side `ncl` polls.

Execution: the host sweep sees a due row → stage 4 wake → stage 5 runs pre-task scripts (`task-script.ts`: bash, 30 s, last stdout line `{wakeAgent, data}`), renders `<task>` → stage 6. The final text becomes a `task_log` row (run log `groups/<folder>/tasks/<series>.md`), never a chat message; the agent must call `send_message` to reach a person. On completion the sweep arms the next row (`armNextTask`); failures back off 2/4/8/16/32/60 min and pause after 8 in a row.

## How a user triggers it

"Remind me every day at 9 to …" in chat; `ncl tasks list|get|pause|resume|run|cancel` on the host.

## How an agent runs and verifies it

- `ncl tasks list`; `ncl tasks run <id>` for an immediate run.
- Task session folder: `data/v2-sessions/<ag>/<sess>/inbound.db` → `select id,kind,status,process_after,recurrence,series_id from messages_in`.
- Run log: `groups/<folder>/tasks/<series>.md`.

## Where it goes wrong

- Up to 60 s latency after `process_after` (sweep cadence).
- Tasks without a script are limited to 4 runs per 24 h (`MAX_DAILY_FIRES`); frequent schedules need a script gate.
- `cli_scope=disabled` on the group makes `ncl` inside the container refuse.
- Timezone: cron is evaluated in `resolveGroupTimezone(group)` (group config, else install TZ); `docs/scheduled-tasks.md` says install TZ, the code wins.

## Version-specific

- Tables: `src/mailbox/sqlite/tasks.ts`; scheduling module `src/modules/scheduling/`; container `scheduling/task-script.ts` (310f739b).
