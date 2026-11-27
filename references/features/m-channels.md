# Mechanism · Channels and wiring

## What it is

Entity model (central DB): `users` (`<channel>:<handle>`) → roles (`user_roles`: owner/admin, global or scoped) and membership (`agent_group_members`); `messaging_groups` (one chat on one platform + adapter instance, with `unknown_sender_policy`); `messaging_group_agents` (the wiring: `engage_mode`, `engage_pattern`, `session_mode`, `sender_scope`, `ignored_message_policy`, `threads`, `priority`); `sessions`.

Adapters: trunk ships `cli` (Unix socket `data/cli.sock`) and the learning branch adds `learning-web`. Chat apps come from the `channels` branch through `/add-<name>` skills, which copy the adapter into `src/channels/`, append one import to `src/channels/index.ts`, pin dependencies, and write credentials to `.env`. Most chat-app adapters wrap the Chat SDK bridge (`src/channels/chat-sdk-bridge.ts`: Discord, Slack, Telegram, Teams, Google Chat, …); WhatsApp (Baileys), Signal, WeChat, DeltaChat are native.

Ingress for webhook platforms: `src/webhook-server.ts` registers `/webhook/<instance>` routes (`registerWebhookAdapter`), logs `Webhook handler error` on failures; a public URL (ngrok or a reverse proxy) must point at it, and a 401 usually means the platform's audience/credentials do not match `.env`. Polling platforms (Telegram) and gateway platforms (Discord) need no route.

Isolation levels (`docs/isolation-model.md`): separate agents per channel; one agent, separate sessions (`shared` per chat); one session across channels (`agent-shared`).

## How a user triggers it

- First agent on the terminal: `scripts/init-cli-agent.ts`; on a chat app: `/init-first-agent`.
- `ncl wirings create --messaging-group <mg> --agent-group <ag> --engage-mode pattern`, `ncl messaging-groups list`, `/manage-channels`.

## How an agent runs and verifies it

- `ncl wirings list`, `ncl users list`, `ncl roles list`.
- `grep "Channel adapter started" logs/nanoclaw.log`.
- Send a message and expect `Message routed` with the wiring's `engage_mode`.

## Where it goes wrong

- Factory returned null: credentials missing in `.env` (`Channel credentials missing, skipping`).
- Instance confusion: two bots of one platform need named instances; delivery never falls back to a sibling instance.
- Unknown sender policy `request_approval` with no owner reachable: messages pile up in `pending_sender_approvals`.

## Version-specific

- Registry `src/channels/channel-registry.ts`; defaults helpers `src/channels/channel-defaults.ts`; migrations 001/010/016/019 define the tables (310f739b).
