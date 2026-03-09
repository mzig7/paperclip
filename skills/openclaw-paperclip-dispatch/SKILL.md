---
name: openclaw-paperclip-dispatch
description: >
  Dispatch Paperclip work from OpenClaw Telegram chats or cron jobs. Use when
  an OpenClaw operator says things like "task the founding engineer with ...",
  or when a scheduled OpenClaw job needs to create, assign, and immediately
  invoke a Paperclip agent through the `paperclipai` CLI.
---

# OpenClaw Paperclip Dispatch

This is a companion skill for OpenClaw operators. It is not a replacement for
the existing `paperclip` skill. The existing `paperclip` skill is still the
heartbeat/control-plane skill used by Paperclip-managed agents. This skill is
only for dispatching work into Paperclip from OpenClaw entrypoints like
Telegram or cron.

## Sources of Truth

Use only these docs for OpenClaw behavior in this repo:

- `doc/OPENCLAW_ONBOARDING.md`
- `packages/adapters/openclaw-gateway/doc/ONBOARDING_AND_TEST_PLAN.md`
- `packages/adapters/openclaw-gateway/README.md`

Treat older legacy `openclaw` webhook docs as out of scope. Paperclip supports
OpenClaw through `openclaw_gateway` only.

## Preconditions

Before using this skill, ensure:

- `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, and `PAPERCLIP_COMPANY_ID` are set,
  or equivalent CLI context/profile defaults exist.
- `PAPERCLIP_REPO_DIR` points at a Paperclip repo checkout, unless your current
  working directory is already inside that repo.
- The companion helper script exists at:
  `~/.openclaw/skills/openclaw-paperclip-dispatch/scripts/dispatch-task.mjs`

This skill relies on the repo-local `pnpm paperclipai ...` command. It does not
call the Paperclip REST API directly.

## Alias Sources

This skill uses two alias files:

- `aliases.generated.json`: generated from the live Paperclip agent roster
- `aliases.manual.json`: optional manual overrides for business-language phrases

Refresh generated aliases whenever the agent roster changes:

```sh
node ~/.openclaw/skills/openclaw-paperclip-dispatch/scripts/sync-aliases.mjs \
  --company-id "$PAPERCLIP_COMPANY_ID"
```

Manual aliases override generated aliases when both define the same key.

## How To Dispatch

Use the helper script as the only execution entrypoint:

```sh
node ~/.openclaw/skills/openclaw-paperclip-dispatch/scripts/dispatch-task.mjs \
  --agent-ref "founding engineer" \
  --task "Implement XYZ task" \
  --mode telegram
```

For cron, prefer structured flags:

```sh
node ~/.openclaw/skills/openclaw-paperclip-dispatch/scripts/dispatch-task.mjs \
  --agent-ref "claudecoder" \
  --task "Run the weekly dependency review and file follow-up issues" \
  --mode cron
```

### Behavior

The helper script will:

1. Resolve the target agent by exact `name`, then exact `urlKey`, then a
   lowercased alias from the generated/manual alias files.
2. Create a Paperclip issue assigned to that agent.
3. Checkout that issue for the agent so it becomes `in_progress`.
4. Invoke `paperclipai heartbeat run --agent-id ...` and stream the live logs.

The script prints the created issue identifier before invocation and repeats it
on failure so the dispatched task is recoverable.

## Telegram Usage

When a human says something like:

`task the founding engineer with XYZ task`

translate that into:

- `agent-ref = founding engineer`
- `task = XYZ task`
- `mode = telegram`

Do not improvise a raw multi-command shell pipeline when the helper script can
do the work.

If deterministic resolution fails:

1. Read the helper's suggested candidate list.
2. Choose the best exact Paperclip ref from that list.
3. Retry once with that exact ref.

Telegram is allowed to make that operator-like choice from the current live
agent roster. The helper itself does not silently guess.

## Cron Usage

Cron jobs should call the helper with structured flags directly.

- Use `--mode cron`.
- Keep the `--task` text self-contained.
- Prefer exact agent refs or synced aliases over fuzzy descriptions.
- Do not heuristic-dispatch in cron mode. If deterministic matching fails, stop
  and fix the alias or the configured agent ref.

## Troubleshooting

- Unknown alias: run `sync-aliases.mjs`, check `aliases.manual.json`, or use the
  exact Paperclip agent `name` or `urlKey`.
- Ambiguous agent: use the exact `urlKey`.
- Issue create or checkout failure: the helper exits non-zero and prints the
  command failure.
- Skipped heartbeat: treat as a failed immediate-dispatch attempt and retry only
  after understanding why the wake was skipped.
- OpenClaw gateway pairing/auth errors: these come from `paperclipai heartbeat run`
  and should be surfaced verbatim. Typical fixes include approving the pending
  device or correcting the gateway token.

## References

- CLI subset: `references/cli.md`
- Gateway invariants: `references/openclaw-gateway.md`
- Generated alias map: `aliases.generated.json`
- Manual alias overrides: `aliases.manual.json`
