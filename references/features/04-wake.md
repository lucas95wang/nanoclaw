# Stage 4 · Wake the container

## What it is

`requestWake(session, reason)` (`src/request-wake.ts`) → `wakeContainer(session)` (`src/container-runner.ts`). If a container for the session is already registered in `activeContainers`, nothing happens (the runner polls its inbound.db by itself). Otherwise `spawnContainer(session)`:

1. Refresh routing files the container reads (`writeSessionRouting`, destinations) and the host-owned runner context.
2. `materializeContainerJson` (from `container_configs`), `initGroupFilesystem` (persona, plugins), and `composeGroupProjectDoc` → `groups/<folder>/CLAUDE.md` rewritten every spawn.
3. `resolveProviderContribution` (Claude: shared `.claude-shared` home, env like `CLAUDE_CODE_AUTO_COMPACT_WINDOW`).
4. `buildMounts`: `/workspace` (session dir, rw), `/workspace/agent` (group folder, rw) with `CLAUDE.md` and `container.json` overlaid read-only, `/app/src` and `/app/skills` read-only from the checkout, `/home/node/.claude` (group-shared, rw), allowlisted extras under `/workspace/extra/<name>`.
5. `ensureGatewaySession`: lease from the credential gateway (OneCLI) → proxy env (`HTTPS_PROXY`, CA file, `ANTHROPIC_AUTH_TOKEN=gateway-managed`).
6. `composeSessionSpec` → `SessionSpec` (image, env, mounts, hardening, resources, runAs) → `validateSpec` refuses secret-shaped env and mis-classed mounts.
7. `claimSessionRun` (DB fence), remove the stale `.heartbeat`, `driver.prepare(spec)` (`docker create --rm --cap-drop=ALL --security-opt no-new-privileges --init --pids-limit …`), then `handle.start()` (`docker start --attach`, the attach stream is the supervisor).

## How a user triggers it

An engaged message on a session with `container_status = stopped`; a due scheduled task (host sweep); `ncl groups restart`.

## How an agent runs and verifies it

- `grep "Spawning session" logs/nanoclaw.log` gives the logical container name; `docker ps --filter label=nanoclaw-install=<slug>` gives the real one (`ncl-<slug>-<sessionId>`).
- `ncl sessions list` → `container_status` running / idle / stopped.
- `stat data/v2-sessions/<ag>/<sess>/.heartbeat` (touched on every provider event).
- Learning trace: `wake:requested`, `wake:already-running` (warm), `wake:spec` (image, mounts, env keys, network, resources), `wake:started` (prepare+start ms), `wake:failed`, `container:ended`.

## Where it goes wrong

- `Container start refused — every retry fails the same way` with `denied-by-policy` / `spec-invalid`: a mount outside the allowlist, a secret in env, or (learning drill) fault `wake-refused`. The sweep retries every 60 s; fix the cause and it heals.
- Gateway unavailable (`Gateway session became unavailable before agent start`): OneCLI down; `docker ps` for `onecli`, `curl $ONECLI_URL/v1/health`.
- Docker not reachable: `Failed to reach container runtime`.
- Image missing after an upgrade: `container/build.sh` or `container/pull.sh`.
- Spawn takes minutes: a derived group image is being rebuilt (`refreshStaleGroupImage`).

## Version-specific

- `spawnContainer` ~line 442, `buildMounts` ~1173, `composeSessionSpec` ~1432 (310f739b). Driver: `src/drivers/docker-driver.ts` (`containerCreateArgs` ~892).
- Resource defaults: pids 2048, shm 1024 MB, cpu/memory unlimited unless `CONTAINER_*_LIMIT` is set.
