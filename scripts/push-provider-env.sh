#!/usr/bin/env bash
# ==========================================================
# LÉLU — send the provider keys held in THIS shell's environment to the
# Contabo VPS and merge them into /etc/lelu/lelu.env there.
#
#   bash scripts/push-provider-env.sh --dry-run          # names only, no connection
#   LELU_VPS=root@157.173.116.95 bash scripts/push-provider-env.sh [--replace]
#
# Run it where BOTH are true: the keys are environment variables, and
# `ssh $LELU_VPS` works (key login as root, or a user with passwordless sudo).
#
# Which names travel (extensible: a new provider needs no edit here)
#   • any *_API_KEY, *_API_KEY_<n>, *_API_KEYS, *_ACCESS_TOKEN, *_API_TOKEN, *_SECRET_KEY;
#   • the bare names in plugins/bareSecretAliases.ts (e.g. Elevenlabs, Elevenlabs2);
#   • anything listed in LELU_PUSH_EXTRA="NAME1 NAME2".
# Never: VITE_*, anything containing ANTHROPIC, CLAUDE_*, and ambient
# platform credentials (GITHUB_TOKEN, AWS_*, CLOUDSDK_*, GOOGLE_APPLICATION_*).
#
# Values are written with the shell builtin printf into ssh's stdin, so they
# never appear in a command line, a URL, a file on this machine or the output.
# ==========================================================
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VPS=${LELU_VPS:-root@157.173.116.95}
DRY=0; FLAGS=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --replace|--no-restart|--no-journal) FLAGS+=("$a") ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

BARE=$(grep -oE 'bare: "[A-Za-z0-9_]+"' "$ROOT/plugins/bareSecretAliases.ts" 2>/dev/null | cut -d'"' -f2 | tr '\n' ' ' || true)
eligible() {
  local k=$1
  case "$k" in VITE_*|CLAUDE_*|GITHUB_TOKEN|AWS_*|CLOUDSDK_*|GOOGLE_APPLICATION_*) return 1 ;; esac
  [[ ${k^^} == *ANTHROPIC* ]] && return 1
  [[ $k =~ _(API_KEY(_?[0-9]+)?|API_KEYS|ACCESS_TOKEN|API_TOKEN|SECRET_KEY)$ ]] && return 0
  [[ " $BARE ${LELU_PUSH_EXTRA:-} " == *" $k "* ]] && return 0
  return 1
}

NAMES=()
while IFS= read -r k; do
  eligible "$k" && [ -n "${!k:-}" ] && NAMES+=("$k")
done < <(compgen -e | sort)
[ ${#NAMES[@]} -gt 0 ] || { echo "no eligible provider variables in this environment" >&2; exit 1; }

echo "== ${#NAMES[@]} variables selected (names only)"
printf '  %s\n' "${NAMES[@]}"
EXCL=$(compgen -e | while read -r k; do [[ ${k^^} == *ANTHROPIC* || $k == VITE_* ]] && echo "$k"; done | tr '\n' ' ' || true)
echo "== excluded on purpose: ${EXCL:-none}"
[ "$DRY" = 1 ] && { echo "== dry run: nothing sent"; exit 0; }

# The receiver travels base64-encoded in the remote command (it holds no
# secrets); the values travel on stdin only.
RECV=$(base64 -w0 "$ROOT/deploy/contabo/inject-env.sh")
SUDO=""; [[ $VPS == root@* ]] || SUDO="sudo -n"
echo "== sending to $VPS"
for k in "${NAMES[@]}"; do printf '%s=%s\n' "$k" "${!k}"; done |
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$VPS" \
    "f=\$(mktemp) && echo $RECV | base64 -d > \$f && $SUDO bash \$f ${FLAGS[*]:-}; rc=\$?; rm -f \$f; exit \$rc"
