#!/usr/bin/env python3
"""Verify imported platform files against their recorded Git blob identities."""

import csv
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / ".ai/modules/plans/data/2026-11-07-platform-disposition.csv"


def blob_id(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()


def main() -> int:
    errors = []
    checked = pending = 0
    with LEDGER.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["disposition"] == "pending":
                pending += 1
                continue
            relative = Path(row["destination"])
            if relative.is_absolute() or ".." in relative.parts:
                errors.append(f"invalid destination: {relative}")
                continue
            target = ROOT / relative
            if not target.is_file():
                errors.append(f"missing: {target}")
            elif blob_id(target) != row["blob"]:
                errors.append(f"modified: {target}")
            checked += 1
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"{checked} baseline files match their source blobs; {pending} entries remain pending.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
