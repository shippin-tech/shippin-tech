#!/usr/bin/env bash
# Exercises auto-update.sh check against a fake docker and a fake update.sh.
# Run: bash deploy/auto-update.test.sh
set -euo pipefail
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp "$src/auto-update.sh" "$work/"
cd "$work"

BASE=ghcr.io/shippin-tech/shippin-tech-scale
OLD=sha256:1111111111111111111111111111111111111111111111111111111111111111
NEW=sha256:2222222222222222222222222222222222222222222222222222222222222222

mkdir -p bin
# Fake docker: `pull` records the call; `image inspect` answers from a mapping file.
cat > bin/docker <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "pull "*) echo "pull $3" >> "$FAKE_LOG"; [[ -f "$FAKE_PULL_FAIL" ]] && exit 1; exit 0 ;;
  "image inspect") ref=${@: -1}; awk -v r="$ref" '$1 == r { print $2 }' "$FAKE_MAP"; exit 0 ;;
  "create "*) echo "create $2" >> "$FAKE_LOG"; echo fakecid; exit 0 ;;
  "cp "*) [[ -d "$FAKE_IMAGE_DEPLOY" ]] || exit 1; cp -r "$FAKE_IMAGE_DEPLOY/." "$3"; echo "cp" >> "$FAKE_LOG"; exit 0 ;;
  "rm "*) exit 0 ;;
esac
exit 1
EOF
# Fake update.sh: records the image it was asked for; fails for digests listed in FAKE_FAIL.
cat > update.sh <<'EOF'
#!/usr/bin/env bash
echo "update $1" >> "$FAKE_LOG"
grep -qxF "$1" "$FAKE_FAIL" 2>/dev/null && exit 1
awk '!/^SHIPPIN_IMAGE=/' server.env > server.env.tmp; printf 'SHIPPIN_IMAGE=%s\n' "$1" >> server.env.tmp; mv server.env.tmp server.env
exit 0
EOF
chmod +x bin/docker update.sh
export PATH="$work/bin:$PATH" FAKE_LOG="$work/calls.log" FAKE_MAP="$work/map" FAKE_FAIL="$work/fail" FAKE_PULL_FAIL="$work/pullfail" FAKE_IMAGE_DEPLOY="$work/image-deploy"

reset() { : > "$FAKE_LOG"; : > "$FAKE_FAIL"; rm -f .update-skip deployments.log "$FAKE_PULL_FAIL"; printf 'COMPOSE_PROJECT_NAME=node-a\nSHIPPIN_IMAGE=%s\n' "$1" > server.env; }
expect() { if [[ "$2" == *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }
refute() { if [[ "$2" != *"$1"* ]]; then echo "ok   $3"; else echo "FAIL $3"; echo "---"; echo "$2"; echo "---"; exit 1; fi; }

# channel already matches the pinned digest -> nothing happens
reset "$BASE@$OLD"; printf '%s %s@%s\n' "$BASE:release" "$BASE" "$OLD" > "$FAKE_MAP"
out=$(bash auto-update.sh check 2>&1)
expect "up to date" "$out" "digest unchanged: no update"
refute "update " "$(cat "$FAKE_LOG")" "digest unchanged: update.sh not called"

# channel moved -> update.sh is called with the pinned @sha256 reference, never the tag
reset "$BASE@$OLD"; printf '%s %s@%s\n' "$BASE:release" "$BASE" "$NEW" > "$FAKE_MAP"
out=$(bash auto-update.sh check 2>&1)
expect "update $BASE@$NEW" "$(cat "$FAKE_LOG")" "new digest: update.sh called with @sha256"
expect "SHIPPIN_IMAGE=$BASE@$NEW" "$(cat server.env)" "new digest: server.env now pins it"

# running image recorded as :sha-<commit>; its digest is resolved before comparing
reset "$BASE:sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
printf '%s %s@%s\n%s %s@%s\n' "$BASE:release" "$BASE" "$OLD" "$BASE:sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$BASE" "$OLD" > "$FAKE_MAP"
out=$(bash auto-update.sh check 2>&1)
expect "up to date" "$out" "sha- tag resolving to the same digest: no update"

# failed health check -> rollback to previous image, digest skipped, not retried
reset "$BASE@$OLD"; printf '%s %s@%s\n' "$BASE:release" "$BASE" "$NEW" > "$FAKE_MAP"; echo "$BASE@$NEW" > "$FAKE_FAIL"
set +e; out=$(bash auto-update.sh check 2>&1); rc=$?; set -e
[[ $rc -ne 0 ]] && echo "ok   failed update exits non-zero" || { echo "FAIL exit code"; exit 1; }
expect "rolled back to $BASE@$OLD" "$out" "failed update: rollback message"
expect $'update '"$BASE@$NEW"$'\nupdate '"$BASE@$OLD" "$(cat "$FAKE_LOG")" "failed update: update.sh called for new then old"
expect "$BASE@$NEW" "$(cat .update-skip)" "failed update: digest recorded in .update-skip"
expect "FAILED $BASE@$NEW" "$(cat deployments.log)" "failed update: deployments.log records the failure"
: > "$FAKE_LOG"
out=$(bash auto-update.sh check 2>&1)
expect "skipping" "$out" "skipped digest: not retried"
refute "update " "$(cat "$FAKE_LOG")" "skipped digest: update.sh not called"
bash auto-update.sh retry >/dev/null
[[ ! -f .update-skip ]] && echo "ok   retry clears .update-skip"

# pull failure -> clear error, nothing changed
reset "$BASE@$OLD"; touch "$FAKE_PULL_FAIL"
set +e; out=$(bash auto-update.sh check 2>&1); rc=$?; set -e
expect "cannot pull" "$out" "pull failure: reported"
expect "SHIPPIN_IMAGE=$BASE@$OLD" "$(cat server.env)" "pull failure: server.env untouched"

# channel override
reset "$BASE@$OLD"; echo 'SHIPPIN_CHANNEL=beta' >> server.env; printf '%s %s@%s\n' "$BASE:beta" "$BASE" "$OLD" > "$FAKE_MAP"
out=$(bash auto-update.sh check 2>&1)
expect "pull $BASE:beta" "$(cat "$FAKE_LOG")" "SHIPPIN_CHANNEL selects the tag"

# status never needs docker
out=$(bash auto-update.sh status 2>&1)
expect "channel:   $BASE:beta" "$out" "status prints the channel"

# deploy scripts are refreshed from the image before update.sh runs; server.env is left alone
reset "$BASE@$OLD"; printf '%s %s@%s\n' "$BASE:release" "$BASE" "$NEW" > "$FAKE_MAP"
mkdir -p "$FAKE_IMAGE_DEPLOY"
printf '# new compose from image\n' > "$FAKE_IMAGE_DEPLOY/compose.yaml"
cp update.sh "$FAKE_IMAGE_DEPLOY/update.sh"
printf 'RECOVERY_ADMIN=should-not-be-copied\n' > "$FAKE_IMAGE_DEPLOY/server.env.example"
printf '# old compose\n' > compose.yaml
out=$(bash auto-update.sh check 2>&1)
expect "create $BASE@$NEW" "$(cat "$FAKE_LOG")" "scripts come from the exact digest being deployed"
expect "refreshed compose.yaml" "$out" "changed compose.yaml is replaced"
refute "refreshed update.sh" "$out" "identical update.sh is left alone"
expect "# new compose from image" "$(cat compose.yaml)" "compose.yaml content is the image's"
refute "should-not-be-copied" "$(cat server.env)" "server.env is never touched"
expect $'create\ncp\nupdate ' "$(grep -E '^(create|cp|update )' "$FAKE_LOG" | sed 's/^create .*/create/')" "refresh runs before update.sh"
rm -rf "$FAKE_IMAGE_DEPLOY"

# an image without deploy scripts (older build) is tolerated
reset "$BASE@$OLD"; printf '%s %s@%s\n' "$BASE:release" "$BASE" "$NEW" > "$FAKE_MAP"
out=$(bash auto-update.sh check 2>&1)
expect "carries no deploy scripts" "$out" "older image: refresh skipped with a note"
expect "update $BASE@$NEW" "$(cat "$FAKE_LOG")" "older image: update still runs"
echo "all auto-update tests passed"
