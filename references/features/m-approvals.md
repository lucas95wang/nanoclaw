# Mechanism · Approvals and the guard

## What it is

Privileged actions go through `guard(action, input)` (`src/guard/`): every action is defined with `defineGuardedAction`, and the decision is `allow`, `deny` or `hold` (needs a human). Holds become `pending_approvals` rows and a card (Approve / Reject) delivered to an approver chosen by `pickApprover` (group admin → global admin → owner) through `pickApprovalDelivery`. A click arrives as an `onAction` callback (stage 1 seam), is checked by `isAuthorizedApprovalClick`, flips the row with a compare-and-set, and replays the action with the approval row as a grant; a grant satisfies only a hold, never a deny.

Sources of holds: self-modification (`install_packages`, `add_mcp_server` always hold from a container), agent-to-agent creation and sends (when a policy exists), sender admission and channel registration (permissions module), `ncl` commands registered with `access: 'approval'`, and gateway requests: OneCLI tools set to "Ask" raise native events that `src/gateway-approval-coordinator.ts` turns into the same card flow (default timeout 120 s, max 1 h; Anthropic model traffic and configured read-only hosts are auto-allowed).

## How a user triggers it

Ask the agent to install a package ("install ripgrep in your sandbox") or to create another agent; the owner gets a card in their chat.

## How an agent runs and verifies it

- `pnpm exec tsx scripts/q.ts data/v2.db "select id,kind,status,created_at from pending_approvals order by created_at desc limit 5"`.
- `ncl roles list` to see who can approve.
- Conformance test `src/guard/conformance.test.ts` lists every guarded action.

## Where it goes wrong

- No owner or admin exists: holds have nobody to go to and expire.
- The approval subscription to the gateway drops: pending requests are denied, admissions close, running sessions stop (by design, fail closed).
- Clicking from a non-approver account is ignored.

## Version-specific

- `src/modules/approvals/primitive.ts` (`requestApproval`, `registerApprovalHandler`), `src/modules/self-mod/guard.ts`, `src/modules/permissions/guard.ts` (310f739b).
