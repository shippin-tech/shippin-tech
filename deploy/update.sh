#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ $# != 1 || ! "$1" =~ ^ghcr\.io/[a-z0-9._/-]+(@sha256:[a-f0-9]{64}|:sha-[a-f0-9]{40})$ ]]; then
  echo 'Usage: bash update.sh ghcr.io/shippinai/shipping-tech-scale@sha256:<digest> (or :sha-<full-commit>)' >&2
  exit 2
fi
[[ -f server.env && -f config.json && -f fdb.cluster ]] || {
  echo 'Prepare server.env, config.json and fdb.cluster first; see README.md.' >&2
  exit 1
}
command -v flock >/dev/null || { echo 'Install util-linux (flock).' >&2; exit 1; }
exec 9>.update.lock
flock -n 9 || { echo 'Another update is running.' >&2; exit 1; }
export SHIPPIN_IMAGE="$1"
compose=(docker compose --env-file server.env -f compose.yaml)
"${compose[@]}" config --quiet
# Pull before touching a running container. Persist the selection only on success.
"${compose[@]}" pull mail
if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 180 mail; then
  echo 'Update failed health checks; selected image was not saved. Inspect docker compose logs and redeploy the previous digest. Data was not rolled back.' >&2
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
