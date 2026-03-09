# Paperclip CLI Subset For OpenClaw Dispatch

Use the repo-local CLI from a Paperclip checkout:

```sh
pnpm paperclipai --help
```

All client commands support:

- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

## Agent Lookup

```sh
pnpm paperclipai agent list --company-id <company-id> --json
pnpm paperclipai agent get <agent-id>
```

The companion skill also ships a helper to rebuild `aliases.generated.json`
from the current live roster:

```sh
node ~/.openclaw/skills/openclaw-paperclip-dispatch/scripts/sync-aliases.mjs \
  --company-id <company-id>
```

## Issue Dispatch

```sh
pnpm paperclipai issue create \
  --company-id <company-id> \
  --title "..." \
  --description "..." \
  --status todo \
  --priority high \
  --assignee-agent-id <agent-id> \
  --json

pnpm paperclipai issue checkout <issue-id> --agent-id <agent-id> --json
```

## Immediate Invocation

```sh
pnpm paperclipai heartbeat run \
  --agent-id <agent-id> \
  --source on_demand \
  --trigger manual
```

For cron-triggered dispatch:

```sh
pnpm paperclipai heartbeat run \
  --agent-id <agent-id> \
  --source automation \
  --trigger system
```

`heartbeat run` streams adapter stdout/stderr live. For OpenClaw gateway agents,
this includes lifecycle lines like `[openclaw-gateway] ...` and structured event
lines like `[openclaw-gateway:event] ...`.
