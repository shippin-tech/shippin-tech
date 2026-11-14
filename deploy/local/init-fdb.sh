#!/bin/bash
set -eu
for attempt in $(seq 1 40); do
  if fdbcli --exec 'status minimal' --timeout 5 2>&1 | grep -q 'The database is available'; then
    chmod a+r /var/fdb/fdb.cluster
    exit 0
  fi
  fdbcli --exec 'configure new single ssd' --timeout 5 >/dev/null 2>&1 || true
  sleep 2
done
echo 'FoundationDB did not become available' >&2
exit 1
