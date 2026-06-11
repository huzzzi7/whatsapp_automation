"""One-off: clear specified digit-normalized phone cells from may.csv (rows 5+ only)."""
from __future__ import annotations

import csv
import io
import sys
from pathlib import Path


CSV_PATH = Path(__file__).resolve().parent / "may.csv"
META_ROWS = 4  # do not modify rows 1-4 (indices 0..3)


def digits_only(s: str) -> str:
    return "".join(c for c in s if c.isdigit())


def main() -> None:
    targets_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if targets_path is None or not targets_path.is_file():
        raise SystemExit(
            "Usage: python clear_phone_cells.py <targets.txt>\n"
            "targets.txt: one digit string per line (spaces ok)."
        )

    raw = CSV_PATH.read_bytes()
    text = raw.decode("utf-8-sig")
    lines = text.splitlines()
    rows: list[list[str]] = [list(r) for r in csv.reader(lines)]
    if not rows:
        raise SystemExit("empty csv")

    targets: set[str] = set()
    for line in targets_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        d = digits_only(line)
        if d:
            targets.add(d)

    max_col = max(len(r) for r in rows)
    for r in rows:
        while len(r) < max_col:
            r.append("")

    cleared: list[tuple[int, int, str, str]] = []
    found_digits: set[str] = set()

    for ri in range(META_ROWS, len(rows)):
        row = rows[ri]
        for ci in range(len(row)):
            cell = row[ci]
            if not cell or not str(cell).strip():
                continue
            d = digits_only(str(cell))
            if d in targets:
                cleared.append((ri + 1, ci + 1, d, cell))
                found_digits.add(d)
                row[ci] = ""

    not_found = sorted(targets - found_digits, key=lambda x: (len(x), x))

    sio = io.StringIO()
    w = csv.writer(sio, lineterminator="\n")
    for row in rows:
        w.writerow(row)
    new_body = sio.getvalue()
    if text.endswith("\n") or text.endswith("\r\n"):
        if not new_body.endswith("\n"):
            new_body += "\n"
    CSV_PATH.write_text(new_body, encoding="utf-8")

    print("Targets (unique digit strings):", len(targets))
    print("Cells cleared:", len(cleared))
    print("Distinct targets matched:", len(found_digits))
    print("Targets not found in any cell:", len(not_found))
    if not_found:
        print("Not found list:")
        for n in not_found:
            print(" ", n)
    print("--- Row,Col (1-based), digits, original preview ---")
    for item in cleared[:500]:
        r, c, d, orig = item
        prev = orig if len(orig) <= 40 else orig[:37] + "..."
        print(f"  ({r},{c}) {d}  {prev!r}")
    if len(cleared) > 500:
        print(f"  ... and {len(cleared) - 500} more")


if __name__ == "__main__":
    main()
