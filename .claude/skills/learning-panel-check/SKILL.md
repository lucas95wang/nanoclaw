---
name: learning-panel-check
description: Verify the NanoClaw learning panel end to end as a real learner would, with a screenshot and a PASS / FAIL / INCONCLUSIVE verdict per step. Use after any change to src/learning/, src/channels/learning-web.ts, learning/panel/ or the trace points, and before claiming the panel works.
---

# Learning panel check

The panel is verified by evidence, not by reading its code: a browser walks the whole learning flow and every step leaves a screenshot plus a verdict in `learning/e2e/out/`. A step that cannot be judged on this machine is INCONCLUSIVE and never counts as passing.

## Preconditions

1. The host runs in learning mode: `pnpm run learn` (or `NANOCLAW_LEARNING=1 node dist/index.js` after `pnpm run build`), `/api/state` answers on `http://127.0.0.1:7788`.
2. The panel is built: `pnpm run learn:build`.
3. The e2e tools exist once: `cd learning/e2e && pnpm install && pnpm run install-browser`.
4. For the tutor and the two tutor-graded exams, the Claude CLI on this host must be signed in (`claude auth status` → `loggedIn: true`). Otherwise those steps report INCONCLUSIVE with the reason.

## Run

```
pnpm run learn:e2e
```

It plays these steps and records each one (step numbers match the learning prompt, section 九.2):

| # | What it checks | Evidence |
|---|---|---|
| 1 | First open says where to start and gives today's suggestion | `01-welcome.png` |
| 2a–2d | A sample message and a free-text message reach all 8 stages in true order; every stage shows real data when clicked; a reply arrives | `02…05` |
| 3a–3c | Step mode: a wrong guess is corrected with the real data, a right guess is confirmed, the rest reveals through stage 8 | `06…08` |
| 4 | The tutor's answer cites the current message (session id, container name, stage events) | `09` |
| 5a–5b | `learner-profile.md` recorded the guess and level; the knowledge map shows the same level | `10` |
| 6a–6c | Retell and scenario are graded; the drill injects a real fault, the panel shows the symptom, the diagnosis is checked, the fault is cleared and a new message is delivered (full recovery) | `11…15` |
| 7 | An old message replays step by step | `16` |
| 8 | A second visit reads the profile and shows progress + suggestion | `17` |
| 9 | No page errors during the run | results.json |

Exit code 1 when any step FAILs. Read `learning/e2e/out/results.json` for the verdicts and open the PNGs for the evidence.

## When a step fails

Fix the cause, then rerun the whole command from the start. Do not rerun only the failed step: later steps depend on the state the earlier ones create (messages, profile entries, faults).

## Design acceptance (manual, after the automated run)

For each key state (idle, flowing, step-paused, error, quiz) open the screenshot at 100% and check against the Linear-style bar: one accent colour only on the active stage, 1 px borders and 6 px radii, consistent 16 px gutters, type sizes 11 / 12.5 / 14, no clipped text, the 3-second test (current step and next action visible at a glance). Note findings in `projects/.../design-review.md` and fix until nothing is left.
