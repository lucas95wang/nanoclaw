# Mechanism · Container isolation

## What it is

Every session runs in its own Docker container from the agent image (`nanoclaw-agent-v2-<slug>:latest`, built by `container/build.sh` from `container/Dockerfile`: `node:22.23.5-slim`, Bun, Claude Code, Chromium, git; or the hardened prebuilt image). The container sees only bind mounts (see stage 4) and runs as the host uid with `--cap-drop=ALL --security-opt no-new-privileges --init --pids-limit 2048`, 1 GB `/dev/shm`, no project root, no `.env`, no `src/`.

Three checks guard mounts and env:
1. `buildMounts` composes a fixed list; extras must pass the allowlist (`~/.config/nanoclaw/mount-allowlist.json`, `src/modules/mount-security/index.ts`: realpath, blocked patterns such as `.ssh`, `.aws`, `.env`, root must be allowlisted, read-only unless `allowReadWrite`).
2. `validateSpec` (`src/drivers/types.ts`) classes every mount (`group-state`, `install-surface`, `identity-material`, `gateway-trust`, `allowlisted-extra`), forces read-only where required, keeps identity material out of the agent container, and refuses secret-shaped env values.
3. Egress: by default containers reach the internet; `NANOCLAW_EGRESS_LOCKDOWN=true` puts them on an internal network where only the gateway is reachable.

## How a user triggers it

`ncl groups config add-mount --id <ag> --host-path … --container-path …` (checked against the allowlist); `NANOCLAW_EGRESS_LOCKDOWN` in `.env`.

## How an agent runs and verifies it

- `docker inspect <container> --format '{{json .Mounts}}'` and `'{{json .HostConfig.CapDrop}}'`.
- `cat ~/.config/nanoclaw/mount-allowlist.json`.
- Learning trace `wake:spec` lists mounts (host → container, mode, class), env keys, hardening and resources.

## Where it goes wrong

- Allowlisting `~` exposes everything under it (the blocked-pattern check looks at the mount root only).
- A mount outside the allowlist → `denied-by-policy`, the sweep retries forever until fixed.
- The agent container's root filesystem is writable (only auxiliary containers are `--read-only`), but the container is removed on exit.

## Version-specific

- Mount classes and `validateSpec` ~line 445 (`src/drivers/types.ts`); allowlist defaults ~58 (`mount-security/index.ts`); image labels `dev.nanoclaw.*` (310f739b).
