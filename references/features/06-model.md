# Stage 6 · Model turn (Claude Agent SDK through the credential gateway)

## What it is

`ClaudeProvider.query()` (`container/agent-runner/src/providers/claude.ts`) calls the Claude Agent SDK with `pathToClaudeCodeExecutable: /pnpm/claude`, `cwd: /workspace/agent`, `resume: <continuation>`, the `claude_code` system-prompt preset plus the runtime addendum, `permissionMode: bypassPermissions`, the `nanoclaw` MCP server (send_message, send_file, ask_user_question, scheduling instructions, …) and hooks: PreToolUse (records the in-flight tool + Bash timeout into `container_state`), PostToolUse, PreCompact (archives the transcript to `conversations/`), SessionStart (memory injection).

The SDK process never holds a real key: `HTTPS_PROXY` points at OneCLI (`host.docker.internal`), which swaps `ANTHROPIC_AUTH_TOKEN=gateway-managed` for the vault credential. The provider yields events: `init` (continuation), `text`, `progress`, `error`, `file`, `activity` (≤ 1/s while streaming), `result`. `processQuery` consumes them, touches `/workspace/.heartbeat` on each, persists the continuation at `init`, delivers complete `<message to="…">` blocks mid-turn, and on `result` marks the batch completed. Auto-compaction triggers at 165k tokens.

## How a user triggers it

Any engaged message. Tool use is the model's decision; a prompt such as "run `df -h` and tell me the free space" makes it call Bash.

## How an agent runs and verifies it

- Transcript: `data/v2-sessions/<ag>/.claude-shared/projects/…/<continuation>.jsonl`.
- Tool in flight: `pnpm exec tsx scripts/q.ts $S/outbound.db "select * from container_state"`.
- Heartbeat: `stat $S/.heartbeat` advances during a turn.
- Learning trace: `model:init`, `model:text`, `model:tool` (tool name, input), `model:progress`, `model:error`, `model:result` (isError, text).

## Where it goes wrong

- `Query error … isSessionInvalid`: stale continuation; the runner clears it and the next message starts a fresh session.
- Gateway errors (`access_restricted`, `credential_not_found`): the vault credential is not attached to this agent; `onecli agents grants list`.
- A turn with unwrapped output: the runner pushes a wrap-nudge retry; replies must be inside `<message to="…">`.
- Rate limits surface as `error` events with `retryable: true`.
- Disallowed SDK tools (Cron*, ScheduleWakeup) are blocked in PreToolUse.

## Version-specific

- `query` ~line 263, hooks ~110–180, event mapping ~320–430 (`providers/claude.ts`, 310f739b). Model defaults come from `container_configs` (group) or `NANOCLAW_DEFAULT_MODEL`.
- Claude Code inside the image: `@anthropic-ai/claude-code@2.1.321`; Bun 1.4.4; base `node:22.23.5-slim`.
