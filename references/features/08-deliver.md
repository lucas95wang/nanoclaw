# Stage 8 · Deliver (host reads outbound.db and sends through the adapter)

## What it is

`src/delivery.ts` runs two polls: the active poll every 1 s over sessions whose container is running/idle, and a sweep poll every 60 s over every active session. `drainSession` reads undelivered rows (`getDueMessages` minus the `delivered` table), then `deliverMessage` per row:

- `kind='system'` → `handleSystemAction` (cli_request, schedule, approvals, …), never sent to a chat.
- `kind='task_log'` → appended to the task run log.
- `channel_type='agent'` → agent-to-agent routing.
- otherwise: resolve the messaging group (origin chat first, then destinations), check the agent may send there, load outbox files, call `deliveryAdapter.deliver(channelType, platformId, threadId, kind, content, files, instance, deliveryId)` → `createChannelDeliveryAdapter()` dispatches to the exact adapter instance.

`completeDelivery` writes `delivered` (in inbound.db, host-owned), clears the attempt row, pauses typing, fans the reply into sibling sessions, runs post-delivery hooks. Failures record `delivery_attempts`; after 3 attempts the row is marked failed. A send that does not settle in 60 s is parked and given up after 1 h.

## How a user triggers it

Any reply. From the terminal `pnpm run chat` prints it; the panel receives it as an SSE `reply` event (`learning-web.deliver`).

## How an agent runs and verifies it

- `grep "Message delivered" logs/nanoclaw.log` (id, channelType, platformMsgId).
- `pnpm exec tsx scripts/q.ts $S/inbound.db "select * from delivered order by delivered_at desc limit 5"`.
- Failures: `pnpm exec tsx scripts/q.ts data/v2.db "select * from delivery_attempts"`.
- Learning trace: `deliver:send` (outboundId, channel, content), `deliver:done` (platformMsgId, firstDelivery), `deliver:failed` (attempts, error).

## Where it goes wrong

- `No adapter for channel type` / `MissingChannelAdapterError`: the target adapter is dark (no credentials, factory returned null); the row retries then fails.
- `unknown messaging group` / `unauthorized channel destination`: the agent tried a chat it is not wired to.
- A detached messaging group (bot removed from the chat) fails deliveries until it rejoins.
- Delivery marked done but the user saw nothing: two host processes (see stage 1).

## Version-specific

- `deliverMessage` ~line 541, `completeDelivery` ~404, `failDelivery` ~444 (`src/delivery.ts`, 310f739b). Constants: `ACTIVE_POLL_MS=1000`, `SWEEP_POLL_MS=60000`, `MAX_DELIVERY_ATTEMPTS=3`, `DELIVERY_DEADLINE_MS=60000`.
