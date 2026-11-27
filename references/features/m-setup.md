# Mechanism · Install, run, upgrade

## What it is

`bash nanoclaw.sh` bootstraps Node 22+, pnpm and native modules, then `pnpm run setup:auto` (`setup/auto.ts`, clack UI) runs the steps: environment → template choice → container image (local build or hardened pull) → gateway install (`/add-onecli` applied, OneCLI containers) → runtime choice + credential (`claude setup-token` captured over a PTY, stored in the vault) → access rules → service (launchd / systemd user unit / nohup) → first ping/pong through a scratch terminal agent → timezone → channel skill → verify. Every step logs to `logs/setup.log` and `logs/setup-steps/`. Skill-applied code changes are committed (`setup: apply add-onecli`).

Running: the service executes `node dist/index.js` from the checkout (`pnpm run build` first); `pnpm run dev` runs `tsx src/index.ts` in the foreground. At startup the host checks `data/upgrade-state.json` against the checkout (`enforceUpgradeTripwire`) and refuses to run after an unsanctioned `git pull`.

Upgrading: `/update-nanoclaw` merges upstream transactionally with snapshot, health check and rollback; `/migrate-nanoclaw` replays customisations on a clean upstream. Fork model: each customisation is a skill, a recipe lists them.

## How a user triggers it

`bash nanoclaw.sh`; `bash setup/lib/restart.sh`; `pnpm exec tsx setup/index.ts --step <name>` to redo one step; `bash nanoclaw.sh --uninstall`.

## How an agent runs and verifies it

- `tail -40 logs/setup.log` for the last run's steps and `user-input` entries.
- `systemctl --user status nanoclaw-v2-<slug>` (Linux) / `launchctl list | grep nanoclaw` (macOS).
- `pnpm exec tsx scripts/upgrade-state.ts get`.

## Where it goes wrong

- Node 23/25 (odd lines) fail the version check; the installer installs node@22 beside them.
- The wizard must run in a real terminal (interactive prompts, PTY capture); from an agent session use tmux and send keys.
- The second `claude setup-token` (for Claude CLI assist) is not persisted; run `claude login` or `claude setup-token` yourself when the CLI must stay signed in.
- Any manual code change on the running checkout trips the tripwire until `upgrade-state.ts set` is run.

## Version-specific

- v2026.11.0 + 310f739b; `setup/auto.ts` (~1860 lines), `setup/lib/claude-assist.ts`, `src/upgrade-state.ts`, `docs/setup-flow.md`, `docs/upgrade-recovery.md`.
