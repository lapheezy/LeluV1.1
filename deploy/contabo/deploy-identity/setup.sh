#!/bin/bash
# ==========================================================
# LÉLU — install the least-privilege, PHONE-OPERATED deploy agent on the VPS.
# Run ONCE as root from the Contabo web console. Re-run with a newer reviewed
# commit to update the pinned scripts.
#
#   bash setup.sh <commit-sha>                     pull agent only (no SSH key; the iPhone route)
#   bash setup.sh <commit-sha> --ssh-key <file>    also the GitHub-Actions SSH route (needs a computer)
#   bash setup.sh --remove                         revoke everything (reports and rollback material kept)
#
# It fetches these files from that exact commit and refuses them unless their
# sha256 equals the pins below (reviewed together with this file):
#   pull.py             the agent: polls GitHub, verifies the OWNER's approval, runs one action
#   run                 the one root wrapper sudo allows, per allow-listed action word
#   voice-tts-moss.sh   recon | apply | accept | rollback  (voice patch)
#   https-ip.sh         check | stage | issue | enable | rollback [all]
#   source-recovery.sh  source-report | source-export | source-export-clean
#   dispatch            SSH forced command (only with --ssh-key)
#
# What it creates:
#   user   lelu-deploy (system, password locked, no login shell use)
#   timer  lelu-deploy-agent.timer → lelu-deploy-agent.service (User=lelu-deploy), every 5 minutes
#   sudo   /etc/sudoers.d/lelu-deploy: `run <action>` for 13 action words, nothing else
#   cmd    /usr/local/bin/lelu-deploy-report (root): the audit trail and the last report
#   dirs   /usr/local/lib/lelu-deploy (root 0755) · /var/lib/lelu-deploy/{incoming,pull} (lelu-deploy 0700)
#          /var/log/lelu-deploy (root 0700)
# It does NOT touch root's authorized_keys, sshd_config, the firewall or the app.
# ==========================================================
set -euo pipefail
REPO=lapheezy/LeluV1.1
LIB=/usr/local/lib/lelu-deploy
HOME_DIR=/var/lib/lelu-deploy
EXPECTED_IP=157.173.116.95
EXPECTED_HOST_FP="SHA256:xtGl0A4EeV4vKuYFpqQXx/MctJWnG/vVEcgfh7yu310"   # seen by a GitHub runner, 2026-11-24
ACTIONS=(recon apply accept rollback https-check https-stage https-issue https-enable https-rollback https-rollback-all source-report source-export source-export-clean)
declare -A PIN=(
  [pull.py]=7b77f07c7ec42f4add809a4dfdfad4c300bdcc85be6488f8cff11d28b607771a
  [run]=48293ce1d21cd7b83031a508a87d09d47c24bc0d83c8868ade4a0a9079f29dfb
  [voice-tts-moss.sh]=1fa32a8e11b1bda419089fd3627b790be85cf1d7c0a65713551feb21cf4521bd
  [https-ip.sh]=ab3314ecd31dd253735055740253606eedb515988a9d054c6e218af50535016a
  [source-recovery.sh]=af919c2fd974bc733d1ed94df5f07ef74dca55dcf10352e2c8a79f955158219b
  [dispatch]=5b6bb196316a40e9e0c6b5a3f4d5ce764c01e57c846c598a724ea7c37d77f4fa
)
declare -A SRC=(
  [pull.py]=deploy/contabo/deploy-identity/pull.py
  [run]=deploy/contabo/deploy-identity/run
  [voice-tts-moss.sh]=deploy/contabo/voice-tts-moss.sh
  [https-ip.sh]=deploy/contabo/https-ip.sh
  [source-recovery.sh]=deploy/contabo/deploy-identity/source-recovery.sh
  [dispatch]=deploy/contabo/deploy-identity/dispatch
)
say() { echo "== $*"; }; ok() { echo "PASS  $*"; }; die() { echo "FAIL  $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"

if [ "${1:-}" = --remove ]; then
  systemctl disable --now lelu-deploy-agent.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/lelu-deploy-agent.service /etc/systemd/system/lelu-deploy-agent.timer /usr/local/bin/lelu-deploy-report /usr/local/bin/lelu-deploy-approve
  rm -rf /etc/lelu-deploy/approvals
  systemctl daemon-reload >/dev/null 2>&1 || true
  rm -f /etc/sudoers.d/lelu-deploy && ok "sudoers entry removed"
  pkill -u lelu-deploy 2>/dev/null || true
  id lelu-deploy >/dev/null 2>&1 && userdel lelu-deploy && ok "user lelu-deploy removed"
  rm -rf "$LIB" "$HOME_DIR/.ssh" "$HOME_DIR/incoming" && ok "agent, timer, key and pinned files removed; audit trail ($HOME_DIR/pull) and /var/log/lelu-deploy kept"
  exit 0
fi

COMMIT=${1:?usage: setup.sh <commit-sha> [--ssh-key <ed25519 .pub file>]   |   setup.sh --remove}
PUB=""
[ "${2:-}" = --ssh-key ] && PUB=${3:?--ssh-key needs a .pub file}

say "1. this must be the LÉLU production VPS"
ip -4 -o addr show 2>/dev/null | grep -qw "$EXPECTED_IP" && ok "this machine holds $EXPECTED_IP" || die "this machine does not hold $EXPECTED_IP"
FP=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')
[ "$FP" = "$EXPECTED_HOST_FP" ] && ok "host key $FP" || die "host key $FP is not $EXPECTED_HOST_FP"
command -v python3 >/dev/null && ok "python3 $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')" || die "python3 is required"

if [ -n "$PUB" ]; then
  say "1b. public key (SSH route)"
  [ -f "$PUB" ] || die "$PUB not found"
  [ "$(grep -cve '^\s*$' "$PUB")" = 1 ] || die "$PUB must hold exactly one key"
  read -r ktype kdata _ < "$PUB"
  [ "$ktype" = ssh-ed25519 ] || die "only an ed25519 key is accepted (got $ktype)"
  grep -q PRIVATE "$PUB" && die "that is a PRIVATE key — use the .pub file"
  ok "ed25519 public key $(ssh-keygen -lf "$PUB" | awk '{print $2}')"
fi

say "2. pinned files from $REPO@$COMMIT"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
for f in "${!SRC[@]}"; do
  [ "$f" = dispatch ] && [ -z "$PUB" ] && continue
  if [ -n "${LELU_SETUP_FROM_DIR:-}" ]; then cp "$LELU_SETUP_FROM_DIR/${SRC[$f]}" "$WORK/$f"     # offline rehearsal only
  else curl -fsSL "https://raw.githubusercontent.com/$REPO/$COMMIT/${SRC[$f]}" -o "$WORK/$f" || die "download of ${SRC[$f]} failed"; fi
  got=$(sha256sum "$WORK/$f" | awk '{print $1}')
  [ "$got" = "${PIN[$f]}" ] && ok "$f sha256 ${got:0:16}… matches its pin" || die "$f sha256 $got does not match pin ${PIN[$f]}"
done

say "3. user, files, sudo, timer"
id lelu-deploy >/dev/null 2>&1 || useradd --system --home-dir "$HOME_DIR" --create-home --shell /bin/bash --comment "LELU deploy agent" lelu-deploy
passwd -l lelu-deploy >/dev/null 2>&1 || true
usermod -L lelu-deploy
install -d -o root -g root -m 0755 "$LIB" "$HOME_DIR"
for f in "${!SRC[@]}"; do [ -f "$WORK/$f" ] && install -o root -g root -m 0755 "$WORK/$f" "$LIB/$f"; done
install -d -o lelu-deploy -g lelu-deploy -m 0700 "$HOME_DIR/incoming" "$HOME_DIR/pull"
install -d -o root -g root -m 0700 /var/log/lelu-deploy
if [ -n "$PUB" ]; then
  install -d -o root -g root -m 0755 "$HOME_DIR/.ssh"
  printf 'restrict,command="%s/dispatch" %s %s lelu-github-deploy\n' "$LIB" "$ktype" "$kdata" > "$WORK/ak"
  install -o root -g root -m 0644 "$WORK/ak" "$HOME_DIR/.ssh/authorized_keys"
else
  rm -rf "$HOME_DIR/.ssh"
fi
{
  echo "# LÉLU deploy identity: one root wrapper, one line per allow-listed action. Managed by setup.sh."
  echo "Defaults:lelu-deploy !requiretty, env_reset, !lecture"
  for a in "${ACTIONS[@]}"; do echo "lelu-deploy ALL=(root) NOPASSWD: $LIB/run $a"; done
} > "$WORK/sudoers"
visudo -cf "$WORK/sudoers" >/dev/null || die "sudoers draft failed visudo"
install -o root -g root -m 0440 "$WORK/sudoers" /etc/sudoers.d/lelu-deploy
visudo -c >/dev/null || { rm -f /etc/sudoers.d/lelu-deploy; die "sudo config invalid after install — entry removed"; }

# No filesystem sandbox here on purpose: the root action sudo launches would
# inherit it and could not back up /etc/lelu or edit nginx. The boundary is
# the sudo allow-list and the pinned, root-owned scripts.
cat > "$WORK/svc" <<UNIT
[Unit]
Description=LÉLU deploy agent — run owner-approved requests from GitHub (pull only)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=lelu-deploy
Group=lelu-deploy
ExecStart=/usr/bin/python3 -I $LIB/pull.py
TimeoutStartSec=2100
UNIT
cat > "$WORK/timer" <<'UNIT'
[Unit]
Description=Poll GitHub for owner-approved LÉLU deployment requests

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
UNIT
install -o root -g root -m 0644 "$WORK/svc" /etc/systemd/system/lelu-deploy-agent.service
install -o root -g root -m 0644 "$WORK/timer" /etc/systemd/system/lelu-deploy-agent.timer
cat > "$WORK/report" <<REPORT
#!/bin/bash
# The deploy agent's audit trail and the newest action report (root only).
echo "== audit (newest last)"; tail -n "\${1:-20}" $HOME_DIR/pull/audit.log 2>/dev/null || echo "(no requests seen yet)"
r=\$(ls -1t $HOME_DIR/pull/reports/*.txt 2>/dev/null | head -1)
[ -n "\$r" ] && { echo "== newest report: \$r"; grep -v '^DETAIL' "\$r" | tail -n 60; }
echo "== timer"; systemctl list-timers lelu-deploy-agent.timer --no-pager 2>/dev/null | head -3
REPORT
install -o root -g root -m 0700 "$WORK/report" /usr/local/bin/lelu-deploy-report
# Second factor: GitHub approval alone never runs anything. A merge and a label
# made with the owner's GitHub token look identical whoever (or whatever) used
# it, so the agent also waits for an approval file only root can write.
install -d -o root -g root -m 0755 /etc/lelu-deploy /etc/lelu-deploy/approvals
cat > "$WORK/approve" <<'APPROVE'
#!/bin/bash
# lelu-deploy-approve <code> — run as root in the Contabo console to let the
# deploy agent run the ONE request it is waiting on (shown below first).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
code=${1:-}
[[ $code =~ ^[0-9a-f]{8}$ ]] || { echo "usage: lelu-deploy-approve <8-character code from the audit log>"; exit 2; }
p=/var/lib/lelu-deploy/pull/pending.json
[ -f "$p" ] || { echo "nothing is waiting for approval"; exit 1; }
fields=$(python3 -I - "$p" "$code" <<'PY'
import json, re, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if d.get("code") != sys.argv[2]:
    sys.exit("that code does not match the request waiting for approval (code %s)" % d.get("code"))
if not re.fullmatch(r"[0-9a-f]{40}", d.get("commit", "")) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{7,63}", d.get("request_id", "")):
    sys.exit("pending request is malformed — not approved")
print(d["commit"], d["request_id"])
print("  commit   ", d["commit"], file=sys.stderr)
print("  PR       ", "https://github.com/lapheezy/LeluV1.1/pull/%s" % int(d.get("pr", 0)), file=sys.stderr)
print("  request  ", d["request_id"], file=sys.stderr)
print("  action   ", re.sub(r"[^a-z-]", "?", str(d.get("action", ""))), file=sys.stderr)
print("  expires  ", re.sub(r"[^0-9TZ:+-]", "?", str(d.get("not_after", ""))), file=sys.stderr)
for k, v in (d.get("artifacts") or {}).items():
    print("  artifact ", re.sub(r"[^a-z0-9-]", "?", k), re.sub(r"[^0-9a-f]", "?", str(v)), file=sys.stderr)
PY
) || exit 1
read -r commit request <<<"$fields"
read -r -p "Approve exactly this deployment? Type yes: " answer
[ "$answer" = yes ] || { echo "not approved"; exit 1; }
umask 022
printf 'commit=%s\nrequest=%s\napproved=%s\n' "$commit" "$request" "$(date -u +%FT%TZ)" > "/etc/lelu-deploy/approvals/$code.tmp"
mv -f "/etc/lelu-deploy/approvals/$code.tmp" "/etc/lelu-deploy/approvals/$code"
echo "approved. The agent runs it on its next poll (within 5 minutes), or now: systemctl start lelu-deploy-agent.service"
echo "then read the result with: lelu-deploy-report"
APPROVE
install -o root -g root -m 0700 "$WORK/approve" /usr/local/bin/lelu-deploy-approve
systemctl daemon-reload
systemctl enable --now lelu-deploy-agent.timer >/dev/null
ok "user, pinned files, sudoers (visudo clean), timer enabled, lelu-deploy-report and lelu-deploy-approve installed"

say "4. self-test: the agent can do exactly this and nothing else"
sudo -n -l -U lelu-deploy | grep -E "$LIB/run" | sed 's/^ */  allowed: /'
runuser -u lelu-deploy -- sudo -n /bin/true 2>/dev/null && die "lelu-deploy can run arbitrary commands with sudo" || ok "sudo /bin/true refused"
runuser -u lelu-deploy -- sudo -n "$LIB/run" "recon; id" 2>/dev/null && die "argument injection accepted" || ok "sudo run with an unlisted argument refused"
runuser -u lelu-deploy -- test -w "$LIB/run" && die "lelu-deploy can edit the root wrapper" || ok "pinned scripts not writable by lelu-deploy"
runuser -u lelu-deploy -- test -w "$LIB/pull.py" && die "lelu-deploy can edit the agent" || ok "the agent itself is not writable by lelu-deploy"
runuser -u lelu-deploy -- test -w /etc/lelu-deploy/approvals && die "lelu-deploy can write console approvals" || ok "console approvals not writable by lelu-deploy"
runuser -u lelu-deploy -- test -r /etc/lelu/lelu.env && die "lelu-deploy can read lelu.env" || ok "lelu.env not readable by lelu-deploy"
[ -z "$PUB" ] && { [ -e "$HOME_DIR/.ssh/authorized_keys" ] && die "an SSH key exists although none was asked for" || ok "no SSH key installed (pull route only)"; }
systemctl is-enabled --quiet lelu-deploy-agent.timer && ok "timer enabled" || die "timer not enabled"
systemctl start lelu-deploy-agent.service && ok "first poll ran (see: lelu-deploy-report)" || echo "INFO  first poll did not complete; see: journalctl -u lelu-deploy-agent"
echo
ok "deploy agent ready. Approve a deployment on GitHub: merge a PR that changes deploy/contabo/deploy-request.json,"
echo "      after adding the label deploy-approved yourself. Nothing runs until you also type, here in the console,"
echo "      lelu-deploy-approve <code>   (the code is in: lelu-deploy-report). Read results with: lelu-deploy-report"
