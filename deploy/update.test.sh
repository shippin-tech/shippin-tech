#!/usr/bin/env bash
# Exercises update.sh against a fake docker: order of operations, bootstrap-mode
# detection, and that server.env is only rewritten after a verified healthy node.
# Run: bash deploy/update.test.sh
set -euo pipefail
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp "$src/update.sh" "$src/compose.yaml" "$work/"
cd "$work"
IMG=ghcr.io/shippin-tech/shippin-tech-scale@sha256:2222222222222222222222222222222222222222222222222222222222222222

mkdir -p bin
# Fake docker compose: logs the subcommand; "up" fails if FAKE_UP_FAIL exists,
# "exec" (the config-file probe) fails if FAKE_BOOTSTRAP exists.
cat > bin/docker <<'EOF'
#!/usr/bin/env bash
shift # compose
while [[ $# -gt 0 ]]; do case "$1" in --env-file|-f) shift 2 ;; *) break ;; esac; done
echo "$1" >> "$FAKE_LOG"
case "$1" in
  up) [[ -f "$FAKE_UP_FAIL" ]] && exit 1 ;;
  exec) [[ -f "$FAKE_BOOTSTRAP" ]] && exit 1 ;;
  run) echo "run:$*" >> "$FAKE_LOG" ;;
esac
exit 0
EOF
cat > bin/flock <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x bin/docker bin/flock
export PATH="$work/bin:$PATH" FAKE_LOG="$work/calls.log" FAKE_UP_FAIL="$work/upfail" FAKE_BOOTSTRAP="$work/bootstrap"

reset() {
  : > "$FAKE_LOG"; rm -f "$FAKE_UP_FAIL" "$FAKE_BOOTSTRAP" deployments.log server.env.previous
  printf 'COMPOSE_PROJECT_NAME=node-a\nSHIPPIN_IMAGE=old\nRECOVERY_ADMIN=admin:secret\n' > server.env
  echo '{}' > config.json; echo 'x' > fdb.cluster
}
expect() { if [[ "$2" == *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }
refute() { if [[ "$2" != *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }

# happy path
reset
out=$(bash update.sh "$IMG" 2>&1)
expect "Healthy: $IMG" "$out" "healthy node is reported"
expect $'config\npull\nrun' "$(cat "$FAKE_LOG")" "pull happens before the seed step"
expect "test -f /var/lib/shippin.tech/config.json || cp /etc/shippin.tech/seed.json" "$(cat "$FAKE_LOG")" "seed copies config.json into the data volume only when missing"
expect $'up\nexec' "$(grep -vE '^run:' "$FAKE_LOG" | tr '\n' '\n')" "config-file probe runs after up"
expect "SHIPPIN_IMAGE=$IMG" "$(cat server.env)" "server.env records the image"
expect "RECOVERY_ADMIN=admin:secret" "$(cat server.env)" "server.env keeps the other settings"
expect "$IMG" "$(cat deployments.log)" "deployments.log appended"
refute "Warning: RECOVERY_ADMIN" "$out" "no warning when RECOVERY_ADMIN is set"

# bootstrap mode after up -> fail, nothing saved
reset; touch "$FAKE_BOOTSTRAP"
set +e; out=$(bash update.sh "$IMG" 2>&1); rc=$?; set -e
[[ $rc -ne 0 ]] && echo "ok   bootstrap mode exits non-zero" || { echo "FAIL bootstrap rc"; exit 1; }
expect "bootstrap mode" "$out" "bootstrap mode is named in the error"
expect "SHIPPIN_IMAGE=old" "$(cat server.env)" "bootstrap mode: server.env untouched"
[[ ! -f deployments.log ]] && echo "ok   bootstrap mode: nothing logged as deployed"

# health check failure -> fail, nothing saved
reset; touch "$FAKE_UP_FAIL"
set +e; out=$(bash update.sh "$IMG" 2>&1); rc=$?; set -e
[[ $rc -ne 0 ]] && echo "ok   failed health check exits non-zero" || { echo "FAIL up rc"; exit 1; }
expect "SHIPPIN_IMAGE=old" "$(cat server.env)" "failed health check: server.env untouched"
refute "exec" "$(cat "$FAKE_LOG")" "failed health check: probe not run"

# missing RECOVERY_ADMIN -> warning but still proceeds
reset; sed -i '/^RECOVERY_ADMIN=/d' server.env
out=$(bash update.sh "$IMG" 2>&1)
expect "Warning: RECOVERY_ADMIN" "$out" "missing RECOVERY_ADMIN warns"
expect "Healthy" "$out" "missing RECOVERY_ADMIN still updates"

# bad argument
reset
set +e; out=$(bash update.sh ghcr.io/shippin-tech/shippin-tech-scale:release 2>&1); rc=$?; set -e
[[ $rc -eq 2 ]] && echo "ok   moving tags are rejected" || { echo "FAIL tag rc=$rc"; exit 1; }
echo "all update.sh tests passed"
