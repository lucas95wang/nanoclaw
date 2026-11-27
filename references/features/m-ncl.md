# Mechanism · The ncl admin CLI

## What it is

`ncl <resource> <verb> [id] [--flags]` manages the central DB. Two transports, one dispatcher (`src/cli/dispatch.ts`):

- Host: `bin/ncl` (symlinked to `~/.local/bin/ncl` by setup) → `src/cli/client.ts` → Unix socket `data/ncl.sock` (line-delimited JSON frames) → `src/cli/socket-server.ts` → `dispatch(req, { caller: 'host' })`. The server probes the socket at start so two hosts never share it.
- Container: `/usr/local/bin/ncl` → `container/agent-runner/src/cli/ncl.ts` writes a `kind='system'` row `{action:'cli_request', requestId, command, args}` to outbound.db, then polls inbound.db for the matching `cli_response`. The host's delivery loop (stage 8) runs `registerDeliveryAction('cli_request')` → `dispatch(req, { caller: 'agent' })` and writes the response back with `writeSessionMessage(..., trigger:false)`. Scope is per group (`container_configs.cli_scope`: disabled / group / global); every command declares its guard (`open` / `approval` / `hidden`).

Resources: groups, messaging-groups, wirings, users, roles, members, destinations, sessions, tasks, user-dms. `ncl help`, `ncl <resource> help`.

## How a user triggers it

From the host shell, or the agent runs it in Bash (scheduling, listing its own group).

## How an agent runs and verifies it

- `ncl sessions list`, `ncl groups get <id>`, `ncl groups config get --id <id>`.
- A container-side call leaves a `system` row in outbound.db and a `cli_response` row in inbound.db (learning trace: `outbox:written` kind=system → `deliver:send` systemAction=cli_request → `inbox:written` kind=system).

## Where it goes wrong

- `ncl` says the socket is missing: the host is not running or still starting.
- Inside a container, `cli_scope=disabled` refuses everything; `group` restricts to the caller's own group.
- A `cli_request` is only processed while the delivery poll visits the session (≤ 1 s when running).

## Version-specific

- Registry `src/cli/registry.ts`, resources `src/cli/resources/*.ts`, delivery action `src/cli/delivery-action.ts` (310f739b).
