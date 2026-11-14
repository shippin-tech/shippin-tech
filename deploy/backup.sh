#!/usr/bin/env bash
# Backs up or restores a node that runs the bundled services (COMPOSE_PROFILES=bundled).
#
#   bash backup.sh                         # new backup in ./backups/<UTC time>, keeps the newest $KEEP (7)
#   bash backup.sh list                    # what is there
#   bash backup.sh key                     # prints the key-wrapping key, to keep apart from backups
#   bash backup.sh restore backups/<time> --yes   # replaces ALL mail data with that backup
#
# A backup holds a consistent FoundationDB snapshot (accounts, settings, mail
# index), a mirror of the object storage (message bodies and attachments) taken
# right after it, the server's settings file and server.env. Copy ./backups off
# the host as well; a backup on the same disk does not survive losing the disk.
# Nodes on your own FoundationDB and S3 back those up with their own tools.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

value() { awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' server.env; }
[[ -f server.env ]] || { echo 'Run this in the instance directory.' >&2; exit 1; }
[[ ",$(value COMPOSE_PROFILES)," == *,bundled,* ]] || {
  echo 'backup.sh covers the bundled services only. Back up your own FoundationDB and S3 with their tools.' >&2
  exit 1
}
export COMPOSE_PROFILES="$(value COMPOSE_PROFILES)"
compose=(docker compose --env-file server.env -f compose.yaml)
tool=(docker compose --env-file server.env -f compose.yaml --profile bundled --profile tools run --rm -T objects-tool sh -c)
mc_setup='export HOME=/tmp; cp /tools/mc /tmp/mc && chmod +x /tmp/mc && /tmp/mc alias set s3 http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null'
mkdir -p backups

case "${1:-backup}" in
  backup)
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    # Written under a .partial name and renamed only when every part succeeded,
    # so a listed backup is always a complete one.
    work="$stamp.partial"
    "${compose[@]}" up -d fdb-backup-agent >/dev/null 2>&1
    echo "FoundationDB snapshot..."
    "${compose[@]}" exec -T fdb-backup-agent fdbbackup start -C /var/fdb/fdb.cluster -d "file:///backups/$work/fdb" -w >/dev/null
    echo "Object storage..."
    "${tool[@]}" "$mc_setup && /tmp/mc mirror --quiet \"s3/\$S3_BUCKET\" /backups/$work/objects" >/dev/null
    "${compose[@]}" exec -T mail cat /var/lib/shippin.tech/config.json > "backups/$work/config.json"
    cp server.env "backups/$work/server.env"
    mv -- "backups/$work" "backups/$stamp"
    chmod -R go-rwx "backups/$stamp"
    echo "Backup written to backups/$stamp"
    echo "Not in it, on purpose: the key-wrapping key. Keep one copy apart (bash backup.sh key); a new server needs it to read saved AI keys, sign-in secrets and Google links."
    keep=${KEEP:-7}
    ls -1d backups/*Z/ 2>/dev/null | sort | head -n "-$keep" | while read -r old; do
      "${compose[@]}" run --rm --no-deps -T --user 0 --entrypoint sh fdb-backup-agent -c "rm -rf -- '/backups/$(basename "$old")'" >/dev/null 2>&1 || true
      echo "Removed old backup $old"
    done
    ;;
  key)
    # The key-wrapping key, to keep apart from backups (KEYS.md). Printed only on request.
    "${compose[@]}" exec -T mail cat /var/lib/shippin.tech/key-wrapping.key
    ;;
  list)
    ls -1d backups/*Z/ 2>/dev/null || echo 'No backups yet.'
    ls -1d backups/*.partial/ 2>/dev/null | sed 's/^/incomplete, safe to delete: /' || true
    ;;
  restore)
    dir=${2:-}
    [[ -d "$dir/fdb" && -d "$dir/objects" ]] || { echo "Usage: bash backup.sh restore backups/<time> --yes" >&2; exit 2; }
    [[ "${3:-}" == --yes ]] || { echo "This replaces every account, setting and message with the backup in $dir. Add --yes to go ahead." >&2; exit 2; }
    stamp=$(basename "$dir")
    "${compose[@]}" up -d fdb-backup-agent >/dev/null 2>&1
    echo "Stopping the mail server..."
    "${compose[@]}" stop mail
    echo "Restoring FoundationDB..."
    "${compose[@]}" exec -T fdb-backup-agent fdbcli -C /var/fdb/fdb.cluster --exec 'writemode on; clearrange "" \xff' >/dev/null
    snapshot=$("${compose[@]}" exec -T fdb-backup-agent sh -c "ls -1 /backups/$stamp/fdb | head -1" | tr -d '\r')
    "${compose[@]}" exec -T fdb-backup-agent fdbrestore start -r "file:///backups/$stamp/fdb/$snapshot" --dest-cluster-file /var/fdb/fdb.cluster -w >/dev/null
    echo "Restoring object storage..."
    "${tool[@]}" "$mc_setup && /tmp/mc mirror --quiet --overwrite --remove /backups/$stamp/objects \"s3/\$S3_BUCKET\""
    echo "Starting the mail server..."
    "${compose[@]}" up -d --wait --wait-timeout 300 mail
    echo "Restored from $dir"
    ;;
  *)
    sed -n '2,13p' "$0" >&2
    exit 2
    ;;
esac
