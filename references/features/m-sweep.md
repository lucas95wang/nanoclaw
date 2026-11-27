# Mechanism · Heartbeat and host sweep

## What it is

`src/host-sweep.ts` runs `sweep()` every 60 s. Each active session goes through a keyed reconcile queue into `reconcileSession` (`src/reconcile-session.ts`):

- Mirror `processing_ack` from outbound.db into `messages_in.status`.
- Stuck detection (`decideStuckAction`): kill the container when the heartbeat file is older than `max(30 min, declared Bash timeout)` (`NANOCLAW_ABSOLUTE_CEILING_MS`), or when a message has been `processing` longer than `max(60 s, Bash timeout)` with no heartbeat since (`NANOCLAW_CLAIM_STUCK_MS`). Killed rows go back to `pending` with 5 s × 2ⁿ backoff, max 5 tries, then `failed`.
- Due messages (`countDueMessages`: pending, trigger=1, process_after ≤ now) with no running container → `requestWake(session, 'due-message')`.
- Recurrence: completed recurring task rows get their next row (`armNextTask`).
- Close finished one-shot task sessions; prune echo backlog; re-attach the egress network under lockdown.

The heartbeat is a file touch, `/workspace/.heartbeat`, done by the runner on every provider event (not a DB write). The runner never exits on its own: an idle container is reclaimed by the ceiling rule about 30 minutes after its last event.

## How a user triggers it

Not directly. To watch it: leave a session idle and read `Stopping idle container past absolute ceiling` in the log after ~30 min, or shorten `NANOCLAW_ABSOLUTE_CEILING_MS` in `.env` (minimum 60 s) for an experiment.

## How an agent runs and verifies it

- `stat data/v2-sessions/<ag>/<sess>/.heartbeat` versus `date`.
- `grep -E "absolute ceiling|claimed then silent|marked as failed" logs/nanoclaw.log`.
- `ncl sessions list` shows `container_status`; `docker ps` shows whether the container is really gone.

## Where it goes wrong

- A long tool call without a declared timeout looks stuck after 60 s of silence: the PreToolUse hook records Bash timeouts so the sweep widens its tolerance; other long tools do not get that.
- Pausing a container (debugger, SIGSTOP) trips the stuck rule; the learning panel therefore never blocks the real flow.
- Clock skew between host and container does not matter: the mtime is set by the container but read on the host filesystem.

## Version-specific

- `SWEEP_INTERVAL_MS = 60_000` (`host-sweep.ts` ~35); `decideStuckAction` ~87, `resetStuckProcessingRows` ~316 (`reconcile-session.ts`, 310f739b).
