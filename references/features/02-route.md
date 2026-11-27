# Stage 2 · Route (which chat, which agents, allowed or not)

## What it is

`routeInbound(event)` in `src/router.ts` decides what happens to one inbound event:

1. Message interceptors (approval flows) may consume it.
2. Thread policy: a non-threaded adapter gets `threadId = null`.
3. Messaging-group lookup: `getMessagingGroupWithAgentCount(channelType, platformId, instance)`. No row and the bot was addressed (`isMention`) → auto-create the row. No wired agents → record `dropped_messages(no_agent_wired)` and, if the permissions module is installed, escalate to the owner (`channelRequestGate`).
4. Sender resolution: the permissions module upserts the `users` row (`cli:local`, `learning-web:panel`, `tg:<id>`…).
5. Fan-out: for every wiring in `messaging_group_agents`, `evaluateEngage` (`pattern` regex, `mention`, `mention-sticky`), then the access gate (owner / admin / member / unknown-sender policy) and the sender-scope gate. Engaged → `deliverToAgent(..., wake=true)`. Not engaged but `ignored_message_policy='accumulate'` → stored silently (`wake=false`). Otherwise dropped.
6. Inside `deliverToAgent`: the command gate (`src/command-gate.ts`) filters or denies slash commands before any session exists.

## How a user triggers it

Every message triggers it. The interesting knobs are the wiring row: `ncl wirings list`, `ncl wirings update <id> --engage-mode pattern --engage-pattern '^@nano'`, and the messaging group's `unknown_sender_policy`.

## How an agent runs and verifies it

- Wirings: `ncl wirings list`; messaging groups: `ncl messaging-groups list`.
- Decision evidence: `grep "Message routed" logs/nanoclaw.log` shows `engage_mode`, `wake`, `created`, `userId`.
- Drops: `pnpm exec tsx scripts/q.ts data/v2.db "select reason, channel_type, platform_id, created_at from dropped_messages order by created_at desc limit 5"`.
- Learning mode: trace events `route:messaging-group` (agentCount, policy), `route:engage` per wiring (`engages`, `accessOk`, `scopeOk`, `outcome`), `route:dropped`, `route:command-gate`.

## Where it goes wrong

- `MESSAGE DROPPED — no agent groups wired`: the chat has no wiring. Fix with `ncl wirings create` or the `/init-first-agent` skill.
- `no_agent_engaged`: the pattern did not match or the mention flag was missing.
- Unknown sender under `strict`/`request_approval` policy: message waits for owner approval or is dropped; see `unregistered_senders`.
- A bad `engage_pattern` regex fails open (everyone engages) by design.
- Learning drill fault `route-denied`: the access gate refuses every sender; the trace shows `fault: "route-denied"` and `outcome: "drop"`.

## Version-specific

- `routeInbound` ~line 219, `evaluateEngage` ~480, `deliverToAgent` ~540 in `src/router.ts` (310f739b).
- Hooks registered by modules: `setSenderResolver`, `setAccessGate`, `setSenderScopeGate`, `setChannelRequestGate`, `registerMessageInterceptor`, `registerSessionCreatedHook`.
