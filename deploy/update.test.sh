#!/usr/bin/env bash
# Exercises update.sh against a fake docker: keeping the running server's settings,
# seeding, the cluster file, bootstrap-mode detection, the dry run and the setup key.
# Run: bash deploy/update.test.sh
set -euo pipefail
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp "$src/update.sh" "$src/compose.yaml" "$work/"
cd "$work"
IMG=ghcr.io/shippin-tech/shippin-tech-scale@sha256:2222222222222222222222222222222222222222222222222222222222222222

mkdir -p bin state
# Fake docker. State lives in files under $FAKE:
#   running        container id of the current mail container (absent: none)
#   args           that container's arguments
#   active.json    the settings file that container is using
#   volume.json    the settings file in the data volume (absent: none)
#   cluster        the cluster file in the shared volume
#   upfail / bootstrap / key   failure switches and the setup key
cat > bin/docker <<'EOF'
#!/usr/bin/env bash
log() { echo "$*" >> "$FAKE/calls"; }
if [[ "$1" == compose ]]; then
  shift
  while [[ $# -gt 0 ]]; do case "$1" in --env-file|-f) shift 2 ;; *) break ;; esac; done
  sub=$1; shift
  log "compose $sub $*"
  case "$sub" in
    config|pull) exit 0 ;;
    ps) [[ -f "$FAKE/running" ]] && cat "$FAKE/running"; exit 0 ;;
    up) [[ -f "$FAKE/upfail" ]] && exit 1; rm -f "$FAKE/running"; echo new > "$FAKE/running"; exit 0 ;;
    run)
      all="$*"
      if [[ "$all" == *"test -s /var/lib/shippin.tech/config.json"* ]]; then [[ -f "$FAKE/volume.json" ]]; exit; fi
      if [[ "$all" == *"cp /etc/shippin.tech/seed.json"* ]]; then cp config.json "$FAKE/volume.json"; exit 0; fi
      if [[ "$all" == *"cat > /var/fdb/fdb.cluster"* ]]; then cat > "$FAKE/cluster"; exit 0; fi
      exit 0 ;;
    exec)
      all="$*"
      if [[ "$all" == *"test -f /var/lib/shippin.tech/config.json"* ]]; then [[ ! -f "$FAKE/bootstrap" ]]; exit; fi
      if [[ "$all" == *"setup-key"* ]]; then [[ -f "$FAKE/key" ]] && cat "$FAKE/key"; exit 0; fi
      exit 0 ;;
  esac
  exit 0
fi
case "$1" in
  inspect)
    log "inspect $*"
    if [[ "$*" == *".Args"* ]]; then cat "$FAKE/args" 2>/dev/null; else echo ghcr.io/shippin-tech/shippin-tech-scale:sha-old; fi ;;
  exec)
    log "exec $*"
    [[ -f "$FAKE/active.json" ]] && cat "$FAKE/active.json" || exit 1 ;;
esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > bin/flock
chmod +x bin/docker bin/flock
export PATH="$work/bin:$PATH" FAKE="$work/state"

reset() {
  rm -rf state; mkdir state
  rm -f deployments.log server.env.previous config.json.before-upgrade fdb.cluster
  printf 'COMPOSE_PROJECT_NAME=node-a\nSHIPPIN_IMAGE=old\nMAIL_HOSTNAME=mail.example.com\n' > server.env
  echo '{"@type":"FoundationDb","clusterFile":"/var/fdb/fdb.cluster"}' > config.json
}
external() { echo 'cluster-file' > fdb.cluster; }
bundled() { echo 'COMPOSE_PROFILES=bundled' >> server.env; }
calls() { cat state/calls 2>/dev/null; }
expect() { if [[ "$2" == *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }
refute() { if [[ "$2" != *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }
status_of() { set +e; out=$(bash update.sh "$@" 2>&1); rc=$?; set -e; }

# Fresh external install: seeds from ./config.json and copies the cluster file
reset; external
out=$(bash update.sh "$IMG" 2>&1)
expect "Healthy: $IMG" "$out" "fresh install reports healthy"
expect '"clusterFile"' "$(cat state/volume.json)" "fresh install seeds the volume from ./config.json"
expect "cluster-file" "$(cat state/cluster)" "external setup copies ./fdb.cluster into the shared volume"
expect "SHIPPIN_IMAGE=$IMG" "$(cat server.env)" "server.env records the image"
refute "Warning: RECOVERY_ADMIN" "$out" "no RECOVERY_ADMIN warning any more"

# Upgrade from an older layout: the running server's own settings are kept
reset; external
echo old > state/running
echo '--config /etc/shippin.tech/config.json ' > state/args
echo '{"@type":"FoundationDb","clusterFile":"/var/fdb/fdb.cluster","note":"from the running server"}' > state/active.json
echo '{"@type":"RocksDb","path":"/stale"}' > config.json
out=$(bash update.sh "$IMG" 2>&1)
expect "Kept the running server's settings from /etc/shippin.tech/config.json" "$out" "upgrade reports where the settings came from"
expect "from the running server" "$(cat state/volume.json)" "upgrade seeds the volume with the running server's settings"
expect '"RocksDb"' "$(cat config.json.before-upgrade)" "the old ./config.json is kept as config.json.before-upgrade"
expect "exec old cat /etc/shippin.tech/config.json" "$(calls)" "settings are read from the path the server was started with"

# --config=path form is understood too
reset; external
echo old > state/running
echo '--config=/srv/custom.json ' > state/args
echo '{"@type":"FoundationDb","note":"custom path"}' > state/active.json
bash update.sh "$IMG" >/dev/null 2>&1
expect "custom path" "$(cat state/volume.json)" "--config=path is followed"

# A running server in setup mode has no settings: fall back to ./config.json
reset; external
echo old > state/running
echo '--config /etc/shippin.tech/config.json ' > state/args
out=$(bash update.sh "$IMG" 2>&1)
refute "Kept the running server's settings" "$out" "no settings to keep from a server in setup mode"
expect '"clusterFile"' "$(cat state/volume.json)" "setup-mode server: volume seeded from ./config.json"

# Settings already in the volume are never replaced
reset; external
echo '{"@type":"FoundationDb","note":"already here"}' > state/volume.json
echo old > state/running
echo '{"@type":"RocksDb"}' > state/active.json
bash update.sh "$IMG" >/dev/null 2>&1
expect "already here" "$(cat state/volume.json)" "existing settings in the volume are kept"
refute "cp /etc/shippin.tech/seed.json" "$(calls)" "no seeding when the volume has settings"

# Bundled backing services: no ./fdb.cluster needed, none copied
reset; bundled
out=$(bash update.sh "$IMG" 2>&1)
expect "Healthy" "$out" "bundled install needs no ./fdb.cluster"
refute "cat > /var/fdb/fdb.cluster" "$(calls)" "bundled install does not copy a cluster file"

# External without ./fdb.cluster is refused with a clear message
reset
status_of "$IMG"
[[ $rc -ne 0 ]] && echo "ok   external without a cluster file exits non-zero" || { echo "FAIL rc"; exit 1; }
expect "COMPOSE_PROFILES=bundled" "$out" "message offers the bundled option"

# The first-run key is printed when the server has one
reset; bundled
echo 'AbCdEfGh12345678' > state/key
out=$(bash update.sh "$IMG" 2>&1)
expect "username: admin" "$out" "setup key: tells you to sign in as admin"
expect "key:      AbCdEfGh12345678" "$out" "setup key: prints the key"
expect "https://mail.example.com/login" "$out" "setup key: names the login address"

# Bootstrap mode after start: fail, nothing saved
reset; bundled; touch state/bootstrap
status_of "$IMG"
[[ $rc -ne 0 ]] && echo "ok   setup mode after start exits non-zero" || { echo "FAIL rc"; exit 1; }
expect "SHIPPIN_IMAGE=old" "$(cat server.env)" "setup mode: server.env untouched"
[[ ! -f deployments.log ]] && echo "ok   setup mode: nothing logged as deployed"

# Health check failure: fail, nothing saved
reset; bundled; touch state/upfail
status_of "$IMG"
[[ $rc -ne 0 ]] && echo "ok   failed health check exits non-zero" || { echo "FAIL rc"; exit 1; }
expect "SHIPPIN_IMAGE=old" "$(cat server.env)" "failed health check: server.env untouched"

# Dry run reports and changes nothing
reset; external
echo old > state/running
echo '--config /etc/shippin.tech/config.json ' > state/args
out=$(bash update.sh --check 2>&1)
expect "its settings:   /etc/shippin.tech/config.json" "$out" "dry run names the running server's settings file"
expect "configured:     old" "$out" "dry run shows the image server.env selects"
expect "the running server's /etc/shippin.tech/config.json will be copied in" "$out" "dry run says what will happen"
expect "external" "$out" "dry run names the backing services"
[[ ! -f state/volume.json && ! -f deployments.log ]] && echo "ok   dry run changes nothing"
refute "compose pull" "$(calls)" "dry run pulls nothing"

# Moving tags are refused
reset; bundled
status_of ghcr.io/shippin-tech/shippin-tech-scale:release
[[ $rc -eq 2 ]] && echo "ok   moving tags are rejected" || { echo "FAIL tag rc=$rc"; exit 1; }
echo "all update.sh tests passed"
