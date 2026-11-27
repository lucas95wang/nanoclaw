# Stage 1 · Receive (channel adapter → host)

## What it is

A channel adapter turns a platform event (a terminal line, a WhatsApp message, a panel message) into one `InboundMessage` and hands it to the host through `ChannelSetup.onInbound(platformId, threadId, message)`. The host side of that seam lives in `src/index.ts` inside `initChannelAdapters(...)`: it stamps the receiving adapter instance, serializes `content` to JSON, and calls `routeInbound()` (stage 2). Every channel passes through this one function, so it is the single place where "a message entered NanoClaw" is true.

Adapters self-register on import via `registerChannelAdapter(name, { factory, defaults })` in `src/channels/channel-registry.ts`; the barrel `src/channels/index.ts` lists the enabled ones. A factory may return `null` (missing credentials, or the learning channel outside learning mode) and the channel then stays dark.

## How a user triggers it

- Terminal: `pnpm run chat "hello"` connects to `data/cli.sock` and sends one JSON line (`src/channels/cli.ts` → `handleLine` → `config.onInbound('local', null, …)`).
- Learning panel: the panel POSTs `/api/chat` and `src/channels/learning-web.ts` → `sendFromPanel()` → `config.onInbound('panel', null, …)`.
- A chat app: its skill-installed adapter (`/add-telegram`, `/add-whatsapp`, …) calls the same `onInbound` from its SDK callbacks.

## How an agent runs and verifies it

1. Confirm the adapter is up: `grep "Channel adapter started" logs/nanoclaw.log` (service) or the console (`pnpm run dev`). A dark channel logs `Channel credentials missing, skipping`.
2. Send a message on that channel.
3. Prove it entered: the next stage's log line `Message routed` appears within ~100 ms, or (learning mode) the trace event `stage 1 inbound` carries `channelType`, `platformId`, `message.id`, `content`.
4. The message id is the correlation key for everything after: inbound.db rows are `<id>:<agentGroupId>`, and the reply's `in_reply_to` points back to it.

## Where it goes wrong

- No adapter registered for the type: nothing arrives at all. Check the barrel import and `getRegisteredChannelNames()`.
- Two host processes: the newer one unlinks `data/cli.sock`, the old one keeps the DB. Symptom: replies marked delivered but never shown. `ps aux | grep dist/index.js`.
- `isMention` is adapter-provided; adapters that never set it make `engage_mode='mention'` wirings silent (stage 2 drops with `no_agent_engaged`).
- `supportsThreads=false` adapters have `threadId` forced to `null` in stage 2, so per-thread session modes collapse to one session.

## Version-specific (v2026.11.0 + learning branch, commit 310f739b…)

- Seam location: `src/index.ts` lines ~96–140 (`onInbound` / `onInboundEvent`). The learning trace point sits at the top of `onInbound`.
- Built-in channels on trunk: `cli` only; `learning-web` is added by the learning branch.
- Message id formats: `cli-<ts>-<rand>`, `web-<ts>-<rand>`; namespaced in stage 3 as `<id>:<agent_group_id>`.
