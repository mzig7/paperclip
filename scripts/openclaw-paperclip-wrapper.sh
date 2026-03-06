#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
OPENCLAW_AGENT="${OPENCLAW_AGENT:-}"
OPENCLAW_PROFILE="${OPENCLAW_PROFILE:-}"
CUSTOM_MESSAGE="${OPENCLAW_MESSAGE:-}"

PAPERCLIP_AGENT_ID="${PAPERCLIP_AGENT_ID:-}"
PAPERCLIP_COMPANY_ID="${PAPERCLIP_COMPANY_ID:-}"
PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-http://localhost:3100}"

EXTRA_ARGS=()

while (($# > 0)); do
  case "$1" in
    --openclaw-bin)
      if (($# < 2)); then
        echo "[wrapper] --openclaw-bin requires a value" >&2
        exit 2
      fi
      OPENCLAW_BIN="$2"
      shift 2
      ;;
    --openclaw-agent)
      if (($# < 2)); then
        echo "[wrapper] --openclaw-agent requires a value" >&2
        exit 2
      fi
      OPENCLAW_AGENT="$2"
      shift 2
      ;;
    --openclaw-profile)
      if (($# < 2)); then
        echo "[wrapper] --openclaw-profile requires a value" >&2
        exit 2
      fi
      OPENCLAW_PROFILE="$2"
      shift 2
      ;;
    --message)
      if (($# < 2)); then
        echo "[wrapper] --message requires a value" >&2
        exit 2
      fi
      CUSTOM_MESSAGE="$2"
      shift 2
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! command -v "$OPENCLAW_BIN" >/dev/null 2>&1; then
  echo "[wrapper] OpenClaw CLI not found: $OPENCLAW_BIN" >&2
  echo "[wrapper] Install and verify with: openclaw --version" >&2
  exit 127
fi

if [[ -z "$OPENCLAW_PROFILE" && -n "$PAPERCLIP_COMPANY_ID" && -n "$PAPERCLIP_AGENT_ID" ]]; then
  OPENCLAW_PROFILE="pc-${PAPERCLIP_COMPANY_ID%%-*}-${PAPERCLIP_AGENT_ID%%-*}"
fi

if [[ -z "$OPENCLAW_AGENT" && -n "$PAPERCLIP_AGENT_ID" ]]; then
  OPENCLAW_AGENT="$PAPERCLIP_AGENT_ID"
fi

if [[ -z "$CUSTOM_MESSAGE" ]]; then
  CUSTOM_MESSAGE="Paperclip wakeup for agent ${PAPERCLIP_AGENT_ID:-unknown} in company ${PAPERCLIP_COMPANY_ID:-unknown}. Use the paperclip skill. Re-check assigned issues in statuses todo,in_progress,blocked using API ${PAPERCLIP_API_URL}. If nothing is assigned, report that and exit."
fi

CMD=("$OPENCLAW_BIN")
if [[ -n "$OPENCLAW_PROFILE" ]]; then
  CMD+=("--profile" "$OPENCLAW_PROFILE")
fi
CMD+=("agent")
if [[ -n "$OPENCLAW_AGENT" ]]; then
  CMD+=("--agent" "$OPENCLAW_AGENT")
fi
CMD+=("--message" "$CUSTOM_MESSAGE")
CMD+=("${EXTRA_ARGS[@]}")

echo "[wrapper] invoking: ${CMD[*]}" >&2
exec "${CMD[@]}"
