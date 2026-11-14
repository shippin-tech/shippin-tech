#!/usr/bin/env bash
# Installs or upgrades the mail node to one image, keeping its settings and data.
#
#   bash update.sh ghcr.io/shippin-tech/shippin-tech-scale@sha256:<digest>
#   bash update.sh ghcr.io/shippin-tech/shippin-tech-scale:sha-<full-commit>
#   bash update.sh --check        # report what an update would do; change nothing
#
# Settings: the server reads /var/lib/shippin.tech/config.json in the data volume.
# If the volume has none yet, this script copies the settings the running server is
# using right now (older layouts kept them elsewhere), and only falls back to
# ./config.json when no server is running. Losing that file is what makes a server
# restart in setup mode with a fresh key, so it is never left to chance.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

usage() {
  echo 'Usage: bash update.sh ghcr.io/shippin-tech/shippin-tech-scale@sha256:<digest> (or :sha-<full-commit>)' >&2
  echo '       bash update.sh --check' >&2
  exit 2
}
check_only=false
if [[ "${1:-}" == --check ]]; then
  check_only=true
elif [[ $# != 1 || ! "$1" =~ ^ghcr\.io/[a-z0-9._/-]+(@sha256:[a-f0-9]{64}|:sha-[a-f0-9]{40})$ ]]; then
  usage
fi

[[ -f server.env && -f config.json ]] || {
  echo 'Prepare server.env and config.json first; see README.md.' >&2
  exit 1
}
env_value() { awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' server.env; }
bundled=false
[[ ",$(env_value COMPOSE_PROFILES)," == *,bundled,* ]] && bundled=true
if ! $bundled && [[ ! -f fdb.cluster ]]; then
  echo 'Copy your FoundationDB cluster file to ./fdb.cluster, or set COMPOSE_PROFILES=bundled in server.env.' >&2
  exit 1
fi

if $check_only; then
  export SHIPPIN_IMAGE="$(env_value SHIPPIN_IMAGE)"
else
  export SHIPPIN_IMAGE="$1"
fi
export COMPOSE_PROFILES="$(env_value COMPOSE_PROFILES)"
compose=(docker compose --env-file server.env -f compose.yaml)
"${compose[@]}" config --quiet

# What is running now, and where its settings live.
running=$("${compose[@]}" ps -q mail 2>/dev/null | head -1 || true)
active_path=''
if [[ -n "$running" ]]; then
  args=$(docker inspect -f '{{range .Args}}{{.}} {{end}}' "$running" 2>/dev/null || true)
  if [[ "$args" =~ --config(=|[[:space:]]+)([^[:space:]]+) ]]; then
    active_path=${BASH_REMATCH[2]}
  else
    active_path=/etc/shippin.tech/config.json
  fi
fi
volume_has_config() {
  "${compose[@]}" run --rm --no-deps -T --pull never --entrypoint sh mail -c 'test -s /var/lib/shippin.tech/config.json' >/dev/null 2>&1
}

if $check_only; then
  echo "project:        $(env_value COMPOSE_PROJECT_NAME)"
  echo "backing:        $($bundled && echo 'bundled (FoundationDB, object storage, NATS on this host)' || echo 'external (./fdb.cluster, S3_*, NATS_ADDRESS)')"
  echo "configured:     $SHIPPIN_IMAGE"
  if [[ -n "$running" ]]; then
    echo "running:        $(docker inspect -f '{{.Config.Image}}' "$running") (container ${running:0:12})"
    echo "its settings:   $active_path"
  else
    echo "running:        nothing"
  fi
  if volume_has_config; then
    echo "data volume:    already holds the settings file; it will be kept as is"
  elif [[ -n "$running" ]]; then
    echo "data volume:    no settings file yet; the running server's $active_path will be copied in"
  else
    echo "data volume:    no settings file yet; ./config.json will be copied in"
  fi
  if [[ -n "$(env_value RECOVERY_ADMIN)" ]]; then
    echo "admin login:    RECOVERY_ADMIN is set (break-glass)"
  else
    echo "admin login:    your administrator account; a new server prints a one-time setup key instead"
  fi
  exit 0
fi

command -v flock >/dev/null || { echo 'Install util-linux (flock).' >&2; exit 1; }
exec 9>.update.lock
flock -n 9 || { echo 'Another update is running.' >&2; exit 1; }

# Pull before touching a running container. Persist the selection only on success.
if [[ "${SHIPPIN_PULL:-always}" != never ]]; then
  "${compose[@]}" pull mail
fi

if ! volume_has_config; then
  if [[ -n "$running" ]] && docker exec "$running" cat "$active_path" > .config.running.json 2>/dev/null \
    && grep -q '"@type"' .config.running.json; then
    cp -- config.json config.json.before-upgrade
    cp -- .config.running.json config.json
    echo "Kept the running server's settings from $active_path (previous ./config.json saved as config.json.before-upgrade)."
  fi
  rm -f .config.running.json
  "${compose[@]}" run --rm --no-deps -T --user 0 --entrypoint sh mail -c \
    'cp /etc/shippin.tech/seed.json /var/lib/shippin.tech/config.json && chown 2000:2000 /var/lib/shippin.tech/config.json'
fi
if ! $bundled; then
  # The cluster file is shared through a volume; external setups provide it here.
  # Streamed in rather than mounted, so it works whatever the host path looks like.
  "${compose[@]}" run --rm --no-deps -T --user 0 --entrypoint sh mail -c \
    'cat > /var/fdb/fdb.cluster && chmod a+r /var/fdb/fdb.cluster' < fdb.cluster
fi

if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 300 mail; then
  echo 'Update failed health checks; selected image was not saved. Inspect docker compose logs and redeploy the previous digest. Data was not rolled back.' >&2
  exit 1
fi
# Liveness passes in setup mode too, so check the server really loaded its settings.
if ! "${compose[@]}" exec -T mail test -f /var/lib/shippin.tech/config.json; then
  echo 'The node is running in setup mode: /var/lib/shippin.tech/config.json is missing inside the container. Selected image was not saved.' >&2
  exit 1
fi
umask 077
tmp=$(mktemp ./server.env.XXXXXX)
trap 'rm -f -- "$tmp"' EXIT
awk '!/^SHIPPIN_IMAGE=/' server.env > "$tmp"
printf 'SHIPPIN_IMAGE=%s\n' "$SHIPPIN_IMAGE" >> "$tmp"
cp -- server.env server.env.previous
mv -- "$tmp" server.env
printf '%s %s\n' "$(date -u +%FT%TZ)" "$SHIPPIN_IMAGE" >> deployments.log
echo "Healthy: $SHIPPIN_IMAGE"

key=$("${compose[@]}" exec -T mail cat /var/lib/shippin.tech/setup-key 2>/dev/null | tr -d '[:space:]' || true)
if [[ -n "$key" ]]; then
  echo
  echo "This server has no administrator yet. Open https://$(env_value MAIL_HOSTNAME)/login and sign in as:"
  echo "  username: admin"
  echo "  key:      $key"
  echo "You will create your own administrator; the key then stops working."
fi
