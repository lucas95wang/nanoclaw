# Using this feature map on a customised NanoClaw

## What is generic and what is version-bound

| Generic (stable contract) | Version-specific (expect drift) |
|---|---|
| The eight stages and their order; the container boundary crossed only by `inbound.db` / `outbound.db` | Line numbers and function names cited after "~line" |
| Entity model: users → roles / members; messaging groups → wirings → agent groups → sessions | Table set (migrations add tables; a fork may add its own) |
| One writer per mailbox file; host even / container odd sequences; `journal_mode=DELETE` | Exact column names (`src/mailbox/sqlite/schema.ts`) |
| Composed project document rewritten every spawn; persona in `instructions.prepend.md`; memory owned by the agent | Which files are composed in, the 4 MB cap, hook names |
| Heartbeat file + periodic sweep with a ceiling and a claim-stuck rule | Interval and threshold values, env var names |
| Credential gateway seam: the key never enters the container | Which gateway (OneCLI / Iron Proxy), its port, SDK version |
| Channels self-register; a factory may return null | Which channels are installed and how (skill vs hand-copied) |
| `ncl` dispatch with two transports | Resource list and flags |

When a sentence in a stage file cites a specific line or constant, treat it as a pointer to re-verify, not as a fact: run the "How an agent runs and verifies it" commands and update the Version-specific section.

## Adapting to a fork (example: a company fork of nanoclaw v1/v2 with its own channels)

1. **Find the divergence point.** `git merge-base origin/main upstream/main` and `git diff --stat` against it. Files under `src/` that differ are where this map may be wrong.
2. **Re-anchor the eight stages.** For each stage file, open the cited file in the fork and confirm the function still exists. Typical fork changes:
   - extra channels in `src/channels/` (e.g. `gchat.ts`, `github.ts`) → add rows to the stage 1 "How a user triggers it" list and to m-channels;
   - a different egress setup (a Squid allowlist, a corporate proxy) → rewrite m-isolation's egress paragraph and m-gateway's env list;
   - an older runner (v1: one `messages.db`, stdin piping) → stages 3, 5, 7 and m-mailbox do not apply; keep only the generic contract and describe the fork's own IO.
3. **Re-run the regression order** from README.md on the fork. Every step that needs a different command gets the fork's command written next to it; every step that fails is either a fork bug or a map error, decide which with the evidence commands.
4. **Learning branch pieces are optional.** The fork does not need `src/learning/`; every verification in this map has a non-learning path (logs, `scripts/q.ts`, `ncl`). If the fork wants the panel, port in order: `src/learning/trace.ts` → the five host trace points → the container `learning-trace.ts` + three container points → `src/channels/learning-web.ts` → the server and panel. Keep every call behind `isLearning()`.
5. **Keep the map next to the code.** Put it at `references/features/` in the fork, commit updates with the code change that caused them, and keep the Version-specific sections last so a reader stops before the drift-prone part.

## Known drift: older v2 lines (for example a fork of v2.1.x)

Checked on a company fork at v2.1.46 (merge-base with upstream 2026-07-10):

| This map (v2026.11.0) | Older v2 code |
|---|---|
| `src/mailbox/` seam + `src/mailbox/sqlite/` | mailbox code inline in `src/session-manager.ts` and `src/db/session-db.ts`; runner side in `container/agent-runner/src/db/` |
| `delivery_attempts` table, 60 s send deadline, 1 h give-up, `completeDelivery` / `failDelivery` | attempts in an in-memory `Map` in `src/delivery.ts` (reset on restart), no deadlines; `markDelivered` / `markDeliveryFailed` in `src/db/session-db.ts` |
| `host_instances`, `session_claims`, `wake_signals` (migration 024) | absent; two hosts are not fenced at all |
| `src/request-wake.ts`, `src/reconcile-session.ts` | `wakeContainer` called directly; stuck detection inside `src/host-sweep.ts` |
| log line `Spawning session` | `Spawning container` |
| channels installed by skills | channels such as `gchat.ts`, `github.ts` committed directly in `src/channels/` |

The two-mailbox contract (one writer per file, `journal_mode=DELETE`, even/odd sequence) and the log strings `Message routed`, `Message delivered`, `MESSAGE DROPPED` held on that fork unchanged.

## Maintenance rules

- A code change that moves a function, renames an env var or changes a constant updates the Version-specific section of the affected file in the same commit.
- A new stage-crossing feature (a new kind of outbound row, a new wake reason) gets a bullet in the relevant stage file's "What it is", and a new regression step if it can break silently.
- Never put learning material here; the panel's profile, quizzes and tutor prompts live in `learning/`.
