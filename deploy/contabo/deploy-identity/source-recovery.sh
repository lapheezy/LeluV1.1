#!/usr/bin/env bash
# ==========================================================
# LÉLU — production source recovery (root, pinned; run via the deploy wrapper).
#
#   source-report        read-only: production commit identity, commits GitHub
#                        lacks, uncommitted drift, secret scan — names only
#   source-export        bundle of ONLY the production-only commits plus a
#                        snapshot of the uncommitted drift, refused if the scan
#                        finds a credential or a forbidden file. The bundle is
#                        SEALED (RSA-OAEP-SHA256 + AES-256) to the recipient key
#                        below, whose private half exists only in the LÉLU
#                        integration session; the sealed file is written under
#                        dist/ behind LÉLU's password gate, at an unguessable
#                        path, and removed after 24 h. A root-only plaintext
#                        copy is kept in /var/backups/lelu-source (production's
#                        own preservation copy; it never leaves the VPS).
#   source-export-clean  remove every web export (the root-only copy stays)
#
# The recipient key is part of this pinned file: changing it changes the pin,
# so whoever checks the pin also checks who can open the export.
#
# Never exported: untracked files, .env*, keys, certificates, backups, database
# files, lelu.env (outside the repository anyway). Nothing here changes HEAD,
# the branch, the working tree or the index; the only repository writes are
# remote-tracking refs (git fetch) and one temporary ref, deleted again.
# ==========================================================
set -uo pipefail
APP=/opt/lelu/app
EXPORT_ROOT=$APP/dist/ops-export
KEEP=/var/backups/lelu-source
EXPIRE_HOURS=24
RECIPIENT_PEM='-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAr1C/TgqdNNAXJqowANxU
2mzp+kzQqn2oOb7Z41gNfLRHgzfGG/h7wWD5IT6+Mw8UA7kWcfVNAEo4Twdm2hMf
l3etNv3arLg2ycGFCRUVxUnfD+cU6EyZ3YSh+Y3GTXVZZ9WVI/werBA/7RPFC3wP
LhK5nhkujIFu0tS5PDG3wr9bR4mHJkKHsIm88Mba+tTq5/zMWmniiRHVIolQqeVX
J8c9Bl1VCcwq+1LBovpZcdbrf7zRxKc/a0D88ebBlNSPeId9pjWNRNJVuVY6vA1/
u1zvh5z2/keMIM9pisF7Eu5jFcxcuFFZBa1FD3aHWErGVOC4CIqvdgBV1ixUYhqp
rJ3DW0D6+Y2KQ9hxC0l0YB4Pl1uV0Aohh8p81T/a0rXQxTiLTSlgV39ZeTw7ilkQ
ewbgp8GocQX2Pub7GNs3li4m6faHfHrNCcvpNi18SyxiYstBfGHHDU1Y6dUaoYbO
HxAHoOvtl+QrWyiKbun+Kmkx6svDwCd2XiEcX61ismNOaperGWFY7o3sydJK1FwU
3XW1xNFJvz5R+1ib9/yxseb9cqldQfMesuGvc0bgGy4ljJd2J26srSWdD9mDhLQM
tN5hYlpRXi/kZZ9B1WSJZyjDmNrwNriLVQYLrh0AJGXvQVWLp8ekgDpdb0Nb2L+U
ahm5erJ6UboLuWfvYFBs84MCAwEAAQ==
-----END PUBLIC KEY-----'
TMP_REF=refs/lelu-export/drift
FAILED=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; FAILED=1; }; info() { echo "INFO  $*"; }
g() { runuser -u lelu -- git -C "$APP" "$@"; }

FORBIDDEN_NAMES='(^|/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|ed25519|ecdsa)(\.pub)?|.*\.sqlite3?|.*\.db|.*\.dump|.*\.tar(\.(gz|zst))?|lelu\.env.*|backups?/.*)$'
SECRET_RE='(sk-ant-[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{20,}|sk-or-v1-[a-f0-9]{20,}|sk-[A-Za-z0-9]{32,}|sb_secret_[A-Za-z0-9_-]{10,}|sbp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})'

refresh() { g fetch -q origin 2>/dev/null && ok "fetched GitHub's branches (read-only for production)" || info "could not fetch from GitHub; comparing with the refs already known"; }

# Production-only commits = reachable from HEAD, not from anything GitHub has.
range_list() { g rev-list HEAD --not --remotes=origin; }

scan() {  # $1 = label; stdin = text to scan → prints findings (kind + file), returns 1 if any
  python3 -I -c '
import re, sys
pat = re.compile(sys.argv[1]); label = sys.argv[2]; current = "?"; hits = {}
for line in sys.stdin:
    if line.startswith("+++ b/"): current = line[6:].strip(); continue
    if not line.startswith("+") or line.startswith("+++"): continue
    for m in pat.finditer(line):
        # The KIND only — never any character of the matched value.
        v = m.group(0)
        kind = next((name for prefix, name in (
            ("sk-ant-", "Anthropic key"), ("gsk_", "Groq key"), ("sk-or-v1-", "OpenRouter key"), ("sk-", "OpenAI-style key"),
            ("sb_secret_", "Supabase secret key"), ("sbp_", "Supabase access token"), ("ghp_", "GitHub token"),
            ("github_pat_", "GitHub token"), ("xox", "Slack token"), ("AKIA", "AWS access key"), ("AIza", "Google API key"),
            ("-----BEGIN", "private key block"), ("eyJ", "JWT")) if v.startswith(prefix)), "credential")
        hits.setdefault((current, kind), 0); hits[(current, kind)] += 1
for (f, k), n in sorted(hits.items()):
    print(f"FAIL  {label}: {k} ({n}×) added in {f} — value not shown")
sys.exit(1 if hits else 0)
' "$SECRET_RE" "$1"
}

report() {
  [ -d "$APP/.git" ] || { bad "$APP is not a git checkout"; return; }
  # Every later answer depends on reading the repository as lelu; an
  # unreadable repository must never read as "nothing production-only".
  g rev-parse --verify -q HEAD >/dev/null 2>&1 || { bad "cannot read $APP as the lelu user — nothing can be reported or exported"; return; }
  echo "== production identity"
  info "HEAD $(g rev-parse HEAD) on $(g rev-parse --abbrev-ref HEAD)"
  info "HEAD subject: $(g log -1 --format=%s | cut -c1-100)"
  info "origin: $(g remote get-url origin 2>/dev/null | sed -E 's#//[^@/]*@#//<credentials hidden>@#' || echo none)"
  refresh
  echo "== commits GitHub does not have"
  local list n
  list=$(range_list) || { bad "could not list production-only commits"; return; }
  n=$(printf '%s' "$list" | grep -c . || true)
  info "$n production-only commit(s)"
  g log --format='INFO    %h %ad %s' --date=short HEAD --not --remotes=origin | head -40 | cut -c1-140
  local base; base=$(g merge-base HEAD origin/integration/lelu-four-workforce-consolidation 2>/dev/null)
  [ -n "$base" ] && info "merge-base with integration: $(g log -1 --format='%h %ad %s' --date=short "$base" | cut -c1-110)" || info "no common ancestor with integration found"
  [ -n "$base" ] && info "integration is $(g rev-list --count "$base..origin/integration/lelu-four-workforce-consolidation") commit(s) ahead of that point"
  echo "== files production changed that GitHub does not have"
  if [ "$n" -gt 0 ]; then
    g diff --stat=120 "$(range_list | tail -1)^" HEAD 2>/dev/null | tail -25 | sed 's/^/INFO    /'
  fi
  echo "== uncommitted drift"
  info "modified tracked: $(g diff --name-only | wc -l), staged: $(g diff --cached --name-only | wc -l), untracked (never exported): $(g ls-files --others --exclude-standard | wc -l)"
  g diff --name-only | head -30 | sed 's/^/INFO    modified: /'
  g ls-files --others --exclude-standard | head -30 | sed 's/^/INFO    untracked: /'
  echo "== export safety"
  local names; names=$( { [ "$n" -gt 0 ] && g diff --name-only "$(range_list | tail -1)^" HEAD; g diff --name-only HEAD; } 2>/dev/null | sort -u)
  local bad_names; bad_names=$(printf '%s\n' "$names" | grep -E "$FORBIDDEN_NAMES" || true)
  [ -z "$bad_names" ] && ok "no forbidden file names (.env, keys, certificates, backups, databases)" || { printf '%s\n' "$bad_names" | sed 's/^/FAIL  forbidden file in the export range: /'; FAILED=1; }
  { [ "$n" -gt 0 ] && g log -p --format= HEAD --not --remotes=origin; g diff HEAD; } 2>/dev/null | scan "secret scan" && ok "no credential-shaped text in production-only changes" || FAILED=1
}

recipient_fp() { printf '%s\n' "$RECIPIENT_PEM" | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | cut -c1-64; }

export_bundle() {
  report
  [ $FAILED = 0 ] || { bad "export refused: resolve the findings above first — nothing exported"; return; }
  echo "== export (sealed)"
  command -v openssl >/dev/null || { bad "openssl is required to seal the export"; return; }
  local fp; fp=$(recipient_fp); [ ${#fp} = 64 ] || { bad "recipient key unreadable — nothing exported"; return; }
  info "sealed for recipient key ${fp:0:16}… (the LÉLU integration session)"
  local n; n=$(range_list | wc -l)
  local drift=""; drift=$(g stash create "lelu production drift $(date -u +%FT%TZ)" 2>/dev/null)   # a commit object; working tree untouched
  [ -n "$drift" ] && g update-ref "$TMP_REF" "$drift"
  if [ "$n" = 0 ] && [ -z "$drift" ]; then ok "production has nothing GitHub lacks — no export needed"; return; fi
  local head12; head12=$(g rev-parse --short=12 HEAD)
  # lelu writes the plaintext bundle (it can read the source anyway); root never runs git in lelu's repository.
  local plain_dir seal_dir; plain_dir=$(mktemp -d) seal_dir=$(mktemp -d)
  chmod 0700 "$plain_dir" "$seal_dir"; chown lelu:lelu "$plain_dir"
  local refs=(HEAD); [ -n "$drift" ] && refs+=("$TMP_REF")
  if ! g bundle create "$plain_dir/p.bundle" "${refs[@]}" --not --remotes=origin >/dev/null 2>&1; then
    g update-ref -d "$TMP_REF" 2>/dev/null; rm -rf "$plain_dir" "$seal_dir"; bad "git bundle failed — nothing exported"; return
  fi
  g update-ref -d "$TMP_REF" 2>/dev/null
  g bundle verify "$plain_dir/p.bundle" >/dev/null 2>&1 && ok "bundle verifies against this checkout" || info "bundle verify needs GitHub's commits; it is checked again on import"
  local plain_sum size; plain_sum=$(sha256sum "$plain_dir/p.bundle" | cut -c1-64); size=$(du -h "$plain_dir/p.bundle" | cut -f1)

  # production's own preservation copy: root only, never served
  install -d -o root -g root -m 0700 "$KEEP"
  local kept="$KEEP/$(date -u +%Y%m%dT%H%M%SZ)-$head12.bundle"
  install -o root -g root -m 0600 "$plain_dir/p.bundle" "$kept"
  echo "$plain_sum  $(basename "$kept")" > "$kept.sha256"; chmod 0600 "$kept.sha256"
  ok "root-only preservation copy: $kept"

  # seal: random 256-bit key (hex, in a root-only file — never on a command line),
  # wrapped with RSA-OAEP-SHA256; content AES-256-CBC (PBKDF2). Authenticity is the
  # plaintext SHA-256 below, which the owner relays out of band.
  printf '%s\n' "$RECIPIENT_PEM" > "$seal_dir/recipient.pem"
  ( umask 077; openssl rand -hex 32 | tr -d '\n' > "$seal_dir/k" )
  if openssl pkeyutl -encrypt -pubin -inkey "$seal_dir/recipient.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 \
       -in "$seal_dir/k" -out "$seal_dir/key.oaep" 2>/dev/null \
     && openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass "file:$seal_dir/k" -in "$plain_dir/p.bundle" -out "$seal_dir/bundle.enc" 2>/dev/null; then
    { echo "format=lelu-sealed-bundle-1"; echo "production_head=$(g rev-parse HEAD)"; echo "commits=$n"; echo "drift=$([ -n "$drift" ] && echo yes || echo no)"
      echo "plain_sha256=$plain_sum"; echo "recipient_sha256=$fp"; echo "created=$(date -u +%FT%TZ)"; } > "$seal_dir/manifest.txt"
    rm -f "$seal_dir/k" "$seal_dir/recipient.pem"
    local dir; dir="$EXPORT_ROOT/$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    install -d -o lelu -g lelu -m 0755 "$EXPORT_ROOT" "$dir"
    local name="lelu-production-$head12.sealed"
    tar -C "$seal_dir" --owner=0 --group=0 --numeric-owner -cf "$dir/$name" manifest.txt key.oaep bundle.enc
    chown lelu:lelu "$dir/$name"; chmod 0644 "$dir/$name"
    local sealed_sum; sealed_sum=$(sha256sum "$dir/$name" | cut -c1-64)
    rm -rf "$plain_dir" "$seal_dir"
    command -v systemd-run >/dev/null && systemd-run --quiet --on-active="${EXPIRE_HOURS}h" --unit "lelu-export-expire-$(basename "$dir" | cut -c1-12)" /bin/rm -rf "$dir" >/dev/null 2>&1 \
      && info "the web copy deletes itself in ${EXPIRE_HOURS} h" || info "remove the web copy afterwards with: source-export-clean"
    ok "sealed $n commit(s)$([ -n "$drift" ] && echo " + uncommitted drift"), bundle $size"
    echo "SHA256-PLAIN   $plain_sum"
    echo "SHA256-SEALED  $sealed_sum"
    info "production commit $(g rev-parse HEAD)"
    info "download (signed in to LÉLU): http://157.173.116.95/ops-export/$(basename "$dir")/$name"
  else
    rm -rf "$plain_dir" "$seal_dir"
    bad "sealing failed — nothing exported (the root-only copy in $KEEP remains)"
  fi
}

clean() {
  if [ -d "$EXPORT_ROOT" ]; then rm -rf "$EXPORT_ROOT" && ok "removed every web export under dist/ops-export"; else ok "no web export present"; fi
  [ -d "$KEEP" ] && info "root-only preservation copies kept in $KEEP (remove by hand only when no longer needed)"
}

case "${1:-}" in
  source-report) report;;
  source-export) export_bundle;;
  source-export-clean) clean;;
  *) echo "usage: $0 source-report | source-export | source-export-clean"; exit 2;;
esac
exit $FAILED
