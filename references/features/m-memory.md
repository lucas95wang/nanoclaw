# Mechanism · Memory and per-run context

## What it is

Four layers, each with one owner:

| Layer | File | Written by | Read when |
|---|---|---|---|
| Persona / standing instructions | `groups/<folder>/instructions.prepend.md` | staged once at group creation (`stageGroupPersona`), then edited by the operator or the agent | every spawn |
| Composed project document | `groups/<folder>/CLAUDE.md` (first line "Composed at spawn - do not edit") | host, `composeGroupProjectDoc` in `src/project-doc-compose.ts`, every spawn: persona + runtime rules (`container/CLAUDE.md`) + MCP tool instructions + selected skills' `instructions.md` + MCP server instructions, capped at 4 MB | by Claude Code as the project file (read-only mount) |
| Long-term memory | `groups/<folder>/memory/index.md`, `memory/system/*` | scaffolded by the runner from templates if missing; afterwards only the agent edits it | SessionStart hook (`startup|clear|compact`) injects `index.md` + `system/definition.md`, 16k chars each; not on `resume` |
| Conversation continuation | `outbound.db.session_state['continuation:claude']` + transcript `.jsonl` under `data/v2-sessions/<ag>/.claude-shared/` (group-shared home) | runner at `init`; rotated when the transcript is missing, > 12 MB or > 14 days | every query as `resume` |

Compaction: at 165k tokens Claude Code compacts; PreCompact hooks archive the transcript to `groups/<folder>/conversations/<date>-<summary>.md` and inject compaction instructions that keep `<message>` attributes and delivery rules. Cross-session context (`src/modules/cross-session-context/`) copies recent messages between sibling sessions of one conversation as `trigger=0` rows. Claude Code's own auto-memory is disabled (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`).

## How a user triggers it

"Remember that I prefer short answers" → the agent edits `memory/`. Changing the persona = editing `instructions.prepend.md` (takes effect next spawn). `/clear` starts a new continuation.

## How an agent runs and verifies it

- `head -3 groups/<folder>/CLAUDE.md` after a spawn; `wc -c` to see the composed size.
- `cat groups/<folder>/memory/index.md`.
- `pnpm exec tsx scripts/q.ts $S/outbound.db "select * from session_state"` for the continuation.

## Where it goes wrong

- Editing `CLAUDE.md` directly: overwritten at the next spawn.
- A huge `instructions.prepend.md` is never dropped by the 4 MB cap; other sections are.
- Memory is per group, not per session: two chats wired to one agent share it.
- Old `CLAUDE.local.md` (v1) is not read any more.

## Version-specific

- `composeGroupProjectDoc` ~line 169 (`src/project-doc-compose.ts`); memory hook `container/agent-runner/src/memory/session-hook.ts`; rotation `providers/claude-history.ts` (`CLAUDE_TRANSCRIPT_ROTATE_BYTES`, `_AGE_DAYS`) (310f739b).
