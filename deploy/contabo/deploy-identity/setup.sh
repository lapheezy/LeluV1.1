#!/bin/bash
# ==========================================================
# LÉLU — install the least-privilege deploy identity on the Contabo VPS.
# Run ONCE as root by the owner (from your own SSH session or the Contabo
# console). Re-run with a newer reviewed commit to update the pinned scripts.
#
#   bash setup.sh <commit-sha> /root/lelu_github_deploy.pub
#
# It fetches four files from that exact commit and refuses them unless their
# sha256 equals the pins below (which were reviewed with this file):
#   dispatch            SSH forced command (runs as lelu-deploy)
#   run                 the one root wrapper sudo allows, per action word
#   voice-tts-moss.sh   recon | apply | accept | rollback  (voice patch)
#   https-ip.sh         check | stage | issue | enable | rollback [all]
#
# What it creates:
#   user  lelu-deploy (system, password locked, home /var/lib/lelu-deploy)
#   key   /var/lib/lelu-deploy/.ssh/authorized_keys, ROOT-owned so the user
#         cannot change it:  restrict,command="/usr/local/lib/lelu-deploy/dispatch" <key>
#   sudo  /etc/sudoers.d/lelu-deploy: run <action> for 11 action words, nothing else
#   dirs  /usr/local/lib/lelu-deploy (root 0755, files root 0755)
#         /var/lib/lelu-deploy/incoming (lelu-deploy 0700)  /var/log/lelu-deploy (root 0700)
# It does NOT touch root's own authorized_keys, sshd_config, the firewall or the app.
# Undo: bash setup.sh --remove
# ==========================================================
set -euo pipefail
REPO=lapheezy/LeluV1.1
LIB=/usr/local/lib/lelu-deploy
HOME_DIR=/var/lib/lelu-deploy
EXPECTED_HOST_FP="SHA256:xtGl0A4EeV4vKuYFpqQXx/MctJWnG/vVEcgfh7yu310"   # seen by a GitHub runner, 2026-11-24
ACTIONS=(recon apply accept rollback https-check https-stage https-issue https-enable https-rollback https-rollback-all)
declare -A PIN=(
  [dispatch]=34471eb13c9da780e78ca06177acc5ea78896e1386cce5dc7c543358ddc007db
  [run]=32c92d10f2fe3346f7b15d0a98e4643815a0564f5e9f206b849d484709dd69c8
  [voice-tts-moss.sh]=1fa32a8e11b1bda419089fd3627b790be85cf1d7c0a65713551feb21cf4521bd
  [https-ip.sh]=ab3314ecd31dd253735055740253606eedb515988a9d054c6e218af50535016a
)
declare -A SRC=(
  [dispatch]=deploy/contabo/deploy-identity/dispatch
  [run]=deploy/contabo/deploy-identity/run
  [voice-tts-moss.sh]=deploy/contabo/voice-tts-moss.sh
  [https-ip.sh]=deploy/contabo/https-ip.sh
)
say() { echo "== $*"; }; ok() { echo "PASS  $*"; }; die() { echo "FAIL  $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"

if [ "${1:-}" = --remove ]; then
  rm -f /etc/sudoers.d/lelu-deploy && ok "sudoers entry removed"
  pkill -u lelu-deploy 2>/dev/null || true
  id lelu-deploy >/dev/null 2>&1 && userdel lelu-deploy && ok "user lelu-deploy removed (key gone with it)"
  rm -rf "$HOME_DIR" "$LIB" && ok "identity files removed; reports in /var/log/lelu-deploy and rollback material kept"
  exit 0
fi

COMMIT=${1:?usage: setup.sh <commit-sha> <ed25519 public key file>   |   setup.sh --remove}
PUB=${2:?usage: setup.sh <commit-sha> <ed25519 public key file>}

say "1. host identity (compare with the Contabo console before trusting anything)"
FP=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')
echo "this server's ed25519 host key: $FP"
echo "seen by the GitHub runner:      $EXPECTED_HOST_FP"
[ "$FP" = "$EXPECTED_HOST_FP" ] && ok "they match" || die "they differ: do not add LELU_VPS_KNOWN_HOSTS; something answered the runner that is not this server"
echo "LELU_VPS_KNOWN_HOSTS value (public; paste it into the GitHub secret form):"
echo "  157.173.116.95 $(awk '{print $1, $2}' /etc/ssh/ssh_host_ed25519_key.pub)"

say "2. public key"
[ -f "$PUB" ] || die "$PUB not found"
[ "$(grep -cve '^\s*$' "$PUB")" = 1 ] || die "$PUB must hold exactly one key"
read -r ktype kdata _ < "$PUB"
[ "$ktype" = ssh-ed25519 ] || die "only an ed25519 key is accepted (got $ktype)"
grep -q PRIVATE "$PUB" && die "that is a PRIVATE key — use the .pub file; the private key stays on your computer"
ok "ed25519 public key $(ssh-keygen -lf "$PUB" | awk '{print $2}')"

say "3. pinned files from $REPO@$COMMIT"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
for f in "${!SRC[@]}"; do
  if [ -n "${LELU_SETUP_FROM_DIR:-}" ]; then cp "$LELU_SETUP_FROM_DIR/${SRC[$f]}" "$WORK/$f"     # offline rehearsal only
  else curl -fsSL "https://raw.githubusercontent.com/$REPO/$COMMIT/${SRC[$f]}" -o "$WORK/$f" || die "download of ${SRC[$f]} failed"; fi
  got=$(sha256sum "$WORK/$f" | awk '{print $1}')
  [ "$got" = "${PIN[$f]}" ] && ok "$f sha256 ${got:0:16}… matches its pin" || die "$f sha256 $got does not match pin ${PIN[$f]}"
done

say "4. user, files, key, sudo"
id lelu-deploy >/dev/null 2>&1 || useradd --system --home-dir "$HOME_DIR" --create-home --shell /bin/bash --comment "LELU GitHub deploy (forced command)" lelu-deploy
passwd -l lelu-deploy >/dev/null 2>&1 || true
usermod -L lelu-deploy
install -d -o root -g root -m 0755 "$LIB"
for f in "${!SRC[@]}"; do install -o root -g root -m 0755 "$WORK/$f" "$LIB/$f"; done
install -d -o root -g root -m 0755 "$HOME_DIR"
install -d -o root -g root -m 0755 "$HOME_DIR/.ssh"
install -d -o lelu-deploy -g lelu-deploy -m 0700 "$HOME_DIR/incoming"
install -d -o root -g root -m 0700 /var/log/lelu-deploy
printf 'restrict,command="%s/dispatch" %s %s lelu-github-deploy\n' "$LIB" "$ktype" "$kdata" > "$WORK/ak"
install -o root -g root -m 0644 "$WORK/ak" "$HOME_DIR/.ssh/authorized_keys"
{
  echo "# LÉLU deploy identity: one root wrapper, one line per allow-listed action. Managed by setup.sh."
  echo "Defaults:lelu-deploy !requiretty, env_reset, !lecture"
  for a in "${ACTIONS[@]}"; do echo "lelu-deploy ALL=(root) NOPASSWD: $LIB/run $a"; done
} > "$WORK/sudoers"
visudo -cf "$WORK/sudoers" >/dev/null || die "sudoers draft failed visudo"
install -o root -g root -m 0440 "$WORK/sudoers" /etc/sudoers.d/lelu-deploy
visudo -c >/dev/null || { rm -f /etc/sudoers.d/lelu-deploy; die "sudo config invalid after install — entry removed"; }
ok "user, pinned files, root-owned forced-command key, sudoers (visudo clean)"

say "5. self-test: the identity can do exactly this and nothing else"
sudo -n -l -U lelu-deploy | grep -E "$LIB/run" | sed 's/^ */  allowed: /'
runuser -u lelu-deploy -- sudo -n /bin/true 2>/dev/null && die "lelu-deploy can run arbitrary commands with sudo" || ok "sudo /bin/true refused"
runuser -u lelu-deploy -- sudo -n "$LIB/run" "recon; id" 2>/dev/null && die "argument injection accepted" || ok "sudo run with an unlisted argument refused"
runuser -u lelu-deploy -- test -w "$HOME_DIR/.ssh/authorized_keys" && die "lelu-deploy can edit its own key" || ok "authorized_keys not writable by lelu-deploy"
runuser -u lelu-deploy -- test -w "$LIB/run" && die "lelu-deploy can edit the root wrapper" || ok "pinned scripts not writable by lelu-deploy"
runuser -u lelu-deploy -- test -r /etc/lelu/lelu.env && die "lelu-deploy can read lelu.env" || ok "lelu.env not readable by lelu-deploy"
SSHD=$(sshd -T 2>/dev/null || true)   # captured first: `grep -q` on a live pipe + pipefail misreports
grep -qi '^pubkeyauthentication yes' <<<"$SSHD" && ok "sshd accepts public keys" || echo "INFO  check PubkeyAuthentication in sshd_config"
grep -qiE '^(allowusers|allowgroups) ' <<<"$SSHD" && echo "INFO  sshd has AllowUsers/AllowGroups: add lelu-deploy, or the key cannot log in"
echo
ok "deploy identity ready. GitHub secrets: LELU_VPS_SSH_KEY = the PRIVATE key (from your computer, never chat),"
echo "      LELU_VPS_KNOWN_HOSTS = the line printed in step 1. The workflow already connects as lelu-deploy@157.173.116.95."
