#!/usr/bin/env bash
# Exercises backup.sh against a fake docker: a backup holds the database snapshot, the
# objects, the settings file and server.env, and never the key-wrapping key (KEYS.md),
# which `backup.sh key` prints on request so it can be kept apart.
# Run: bash deploy/backup.test.sh
set -euo pipefail
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp "$src/backup.sh" "$work/"
cd "$work"
KEY='d3JhcHBpbmcta2V5LWZvci10aGUtdGVzdC1vbmx5ISE='

mkdir -p bin state
# Fake docker. Every call is logged in $FAKE/calls. The snapshot step makes the folder a
# real fdbbackup would write into.
cat > bin/docker <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/calls"
all="$*"
if [[ "$all" == *"fdbbackup start"* ]]; then
  dir=$(sed -E 's#.*file:///backups/([^/ ]+)/fdb.*#\1#' <<< "$all")
  mkdir -p "backups/$dir/fdb" "backups/$dir/objects"
  echo snapshot > "backups/$dir/fdb/snapshot"
  exit 0
fi
if [[ "$all" == *"cat /var/lib/shippin.tech/config.json"* ]]; then echo '{"@type":"FoundationDb"}'; exit 0; fi
if [[ "$all" == *"cat /var/lib/shippin.tech/key-wrapping.key"* ]]; then cat "$FAKE/key"; exit 0; fi
exit 0
EOF
chmod +x bin/docker
export PATH="$work/bin:$PATH" FAKE="$work/state"
echo "$KEY" > state/key
printf 'COMPOSE_PROJECT_NAME=node-a\nCOMPOSE_PROFILES=bundled\nS3_ACCESS_KEY=a\nS3_SECRET_KEY=b\n' > server.env
touch compose.yaml

expect() { if [[ "$2" == *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }
refute() { if [[ "$2" != *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }

out=$(bash backup.sh 2>&1)
expect "Backup written to backups/" "$out" "a backup is written"
expect "Not in it, on purpose: the key-wrapping key" "$out" "the backup says the key-wrapping key is left out"
made=$(ls -d backups/*Z)
expect "FoundationDb" "$(cat "$made/config.json")" "the settings file is in the backup"
[[ -f "$made/server.env" ]] && echo "ok   server.env is in the backup" || { echo "FAIL server.env is in the backup"; exit 1; }
refute "$KEY" "$(cat -- $(find "$made" -type f))" "no file in the backup holds the key-wrapping key"
refute "key-wrapping.key" "$(cat state/calls)" "a backup never reads the key-wrapping key"

expect "$KEY" "$(bash backup.sh key 2>&1)" "backup.sh key prints the key-wrapping key on request"
expect "backup.sh key" "$(bash backup.sh help 2>&1 || true)" "the usage names the key command"
echo "backup.sh: all checks passed"
