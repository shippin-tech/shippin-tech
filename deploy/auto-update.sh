#!/usr/bin/env bash
# Keep one mail node on the release channel without anyone typing commands.
#
#   bash auto-update.sh install    # systemd timer: check every 5 minutes (run as root)
#   bash auto-update.sh check      # pull the channel tag; update if the digest changed
#   bash auto-update.sh status     # what is running, what the channel points at, timer state
#   bash auto-update.sh retry      # forget digests that failed their health check
#   bash auto-update.sh uninstall  # remove the timer (the running node is untouched)
#
# The channel tag (default "release", override with SHIPPIN_CHANNEL in server.env) is
# resolved to an immutable @sha256 digest before anything runs, so server.env and
# deployments.log always record exactly which image is live. A failed update is rolled
# back to the previous image and that digest is written to .update-skip so the timer does
# not take the node down again every five minutes.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
here=$(pwd -P)
mode=${1:-check}

log() { printf '%s auto-update %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR $*" >&2; exit 1; }

env_value() { # env_value KEY -> value from server.env or empty
  [[ -f server.env ]] || return 0
  awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' server.env
}

image_base() { # ghcr.io/org/name from SHIPPIN_IMAGE (strips :tag or @digest)
  local image; image=$(env_value SHIPPIN_IMAGE)
  [[ -n "$image" ]] || die 'SHIPPIN_IMAGE is not set in server.env; run update.sh once by hand first.'
  image=${image%%@*}
  printf '%s\n' "${image%:*}"
}

channel_tag() { local c; c=$(env_value SHIPPIN_CHANNEL); printf '%s\n' "${c:-release}"; }

# Digest of a local image reference, as base@sha256:... (empty if unknown).
local_digest() {
  local ref=$1 base=$2
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" 2>/dev/null \
    | grep -m1 -F "${base}@sha256:" || true
}

project_name() { local p; p=$(env_value COMPOSE_PROJECT_NAME); printf '%s\n' "${p:-shippin}"; }
unit_name() { printf 'shippin-update-%s\n' "$(project_name | tr -c 'A-Za-z0-9._-\n' '-')"; }

do_check() {
  [[ -f update.sh && -f server.env ]] || die "update.sh and server.env must sit next to this script in $here"
  local base channel current latest
  base=$(image_base); channel=$(channel_tag); current=$(env_value SHIPPIN_IMAGE)
  log "channel ${base}:${channel}; running ${current}"
  docker pull -q "${base}:${channel}" >/dev/null || die "cannot pull ${base}:${channel} (is docker logged in to ghcr.io?)"
  latest=$(local_digest "${base}:${channel}" "$base")
  [[ -n "$latest" ]] || die "pulled ${base}:${channel} but found no ${base}@sha256 digest for it"
  local current_digest
  if [[ "$current" == *@sha256:* ]]; then current_digest=$current; else current_digest=$(local_digest "$current" "$base"); fi
  if [[ "$latest" == "$current_digest" ]]; then
    log "up to date (${latest#*@})"
    return 0
  fi
  if [[ -f .update-skip ]] && grep -qxF "$latest" .update-skip; then
    log "skipping ${latest#*@}: it failed a health check earlier (bash auto-update.sh retry to try again)"
    return 0
  fi
  log "updating to ${latest#*@}"
  if bash update.sh "$latest"; then
    log "healthy on ${latest#*@}"
    return 0
  fi
  log "update to ${latest#*@} failed its health check; rolling back to ${current}"
  printf '%s\n' "$latest" >> .update-skip
  printf '%s FAILED %s\n' "$(date -u +%FT%TZ)" "$latest" >> deployments.log
  if bash update.sh "$current"; then
    log "rolled back to ${current}"
  else
    die "rollback to ${current} also failed; the node needs a human: docker compose --env-file server.env -f compose.yaml logs mail"
  fi
  return 1
}

do_status() {
  local base channel unit; base=$(image_base); channel=$(channel_tag); unit=$(unit_name)
  echo "instance:  $here"
  echo "running:   $(env_value SHIPPIN_IMAGE)"
  echo "channel:   ${base}:${channel}"
  if command -v systemctl >/dev/null; then
    echo "timer:     $(systemctl is-enabled "${unit}.timer" 2>/dev/null || echo not-installed) / $(systemctl is-active "${unit}.timer" 2>/dev/null || true)"
    systemctl list-timers "${unit}.timer" --no-pager 2>/dev/null | sed -n 2p | sed 's/^/next:      /'
  fi
  [[ -f .update-skip ]] && { echo "skipped (failed health check):"; sed 's/^/  /' .update-skip; }
  [[ -f deployments.log ]] && { echo "last deployments:"; tail -n 5 deployments.log | sed 's/^/  /'; }
  return 0
}

do_install() {
  [[ $EUID -eq 0 ]] || die 'run install as root (sudo bash auto-update.sh install)'
  command -v systemctl >/dev/null || die 'systemd is required for the timer'
  [[ -f update.sh && -f server.env && -f compose.yaml ]] || die "install from the instance directory that holds update.sh, compose.yaml and server.env (not $here)"
  local unit; unit=$(unit_name)
  cat > "/etc/systemd/system/${unit}.service" <<EOF
[Unit]
Description=shippin.tech release-channel update for ${here}
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
WorkingDirectory=${here}
ExecStart=/usr/bin/env bash ${here}/auto-update.sh check
EOF
  cat > "/etc/systemd/system/${unit}.timer" <<EOF
[Unit]
Description=Check the shippin.tech release channel every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=45
Unit=${unit}.service
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "${unit}.timer"
  log "installed ${unit}.timer; running the first check now"
  systemctl start "${unit}.service" || true
  do_status
}

do_uninstall() {
  [[ $EUID -eq 0 ]] || die 'run uninstall as root'
  local unit; unit=$(unit_name)
  systemctl disable --now "${unit}.timer" 2>/dev/null || true
  rm -f "/etc/systemd/system/${unit}.timer" "/etc/systemd/system/${unit}.service"
  systemctl daemon-reload
  log "removed ${unit}; the running node was not changed"
}

case "$mode" in
  check) do_check ;;
  status) do_status ;;
  install) do_install ;;
  uninstall) do_uninstall ;;
  retry) rm -f .update-skip; log 'cleared .update-skip' ;;
  *) sed -n '2,10p' "$0" >&2; exit 2 ;;
esac
