"""remember.py - store a new memory in ONE step, with NO model call.

Writes the memory file AND appends its index row in the same command, so the
catalogue cannot drift from reality: there is no path through this program that
writes one without the other.

  python remember.py "never mock the DB in integration tests" --kind decision
  python remember.py "prefers Gradle KTS over Groovy" --kind pref --tags android,build
  python remember.py --file notes.md          (ingest an existing file)

Kinds, in descending order of durability -- prefer FEEDBACK over FACT:
  decision  a choice made and why            ("chose X over Y because Z")
  pref      how Andrew works                 ("always run tests before commit")
  gotcha    a trap and how to avoid it       ("the BOM breaks the path cache")
  fact      a plain fact -- rots fastest     ("uses PostgreSQL 16")
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brainlib import (  # noqa: E402
    Row, append_rows, knobs_fingerprint, load_config, norm, read_index,
    read_lines_with_offsets, tokenize, validate_row, write_index,
)
import idx as indexer  # noqa: E402

BRAIN_DIR = Path(__file__).resolve().parent
KINDS = ("decision", "pref", "gotcha", "fact")


def title_from(text: str, n: int = 9) -> str:
    words = [w for w in text.strip().split() if w]
    t = " ".join(words[:n])
    return (t[:80] + ("..." if len(words) > n else "")).replace("\n", " ")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("text", nargs="*")
    ap.add_argument("--kind", default="fact", choices=KINDS)
    ap.add_argument("--title", default=None)
    ap.add_argument("--tags", default="")
    ap.add_argument("--file", default=None, help="index an existing file instead")
    a = ap.parse_args()

    cfg = load_config(BRAIN_DIR)
    fp = knobs_fingerprint(cfg)
    index_path = BRAIN_DIR / "index.tsv"
    if not index_path.exists():
        print("BRAIN ERROR: no index yet. Run:  python idx.py", file=sys.stderr)
        return 3
    on_disk_fp, _ = read_index(index_path)
    if on_disk_fp and on_disk_fp != fp:
        print(f"BRAIN ERROR: fingerprint mismatch. Run:  python idx.py", file=sys.stderr)
        return 3

    if a.file:
        subprocess.run([sys.executable, str(BRAIN_DIR / "idx.py"), "--file",
                        norm(a.file)], check=True)
        return 0

    text = " ".join(a.text).strip()
    if not text:
        print("BRAIN: nothing to remember.", file=sys.stderr)
        return 2

    mem_dir = BRAIN_DIR / "memories"
    mem_dir.mkdir(exist_ok=True)
    month = time.strftime("%Y-%m")
    target = mem_dir / f"{month}.md"
    date = time.strftime("%Y-%m-%d")
    title = a.title or title_from(text)
    tags = " ".join(f"#{t.strip()}" for t in a.tags.split(",") if t.strip())

    block = f"\n## [{date}] {a.kind} | {title}\n\n{text}\n"
    if tags:
        block += f"\n{tags}\n"

    # byte_start is measured BEFORE the append, so the row points exactly at
    # the bytes we are about to write. No re-parse, no guessing.
    existed = target.exists()
    start = target.stat().st_size if existed else 0
    if not existed:
        header = f"# Memories {month}\n"
        with open(target, "w", encoding="utf-8", newline="\n") as f:
            f.write(header)
        start = target.stat().st_size
    with open(target, "a", encoding="utf-8", newline="\n") as f:
        f.write(block)
    st = os.stat(target)
    end = st.st_size

    heading = f"[{date}] {a.kind} | {title}"
    kw = list(dict.fromkeys(
        tokenize(title) + tokenize(text) + tokenize(a.tags.replace(",", " "))
        + [a.kind]
    ))
    row = Row(path=norm(target), byte_start=start, byte_end=end, heading=heading,
              kind=f"memory:{a.kind}", keywords=" ".join(kw)[:2000], pointer="",
              confidence="EXTRACTED", mtime_ns=st.st_mtime_ns, size=st.st_size)
    err = validate_row(row, cfg.get("roots", []))
    if err:
        print(f"BRAIN ERROR: refusing to index invalid row: {err}", file=sys.stderr)
        return 4

    # Sibling rows for the same file carry a now-stale mtime/size. Rewrite them
    # so the next query does not trigger a pointless repair of a file we just
    # wrote correctly.
    _, rows = read_index(index_path)
    for r in rows:
        if r.path.casefold() == row.path.casefold():
            r.mtime_ns, r.size = st.st_mtime_ns, st.st_size
    rows.append(row)
    write_index(index_path, rows, fp)
    (BRAIN_DIR / "index.cache").unlink(missing_ok=True)
    indexer.log(BRAIN_DIR, "remember", f"{a.kind} | {title} -> {target.name}")

    print(f"remembered [{a.kind}] {title}")
    print(f"  file  : {target}  (bytes {start}-{end})")
    print(f"  index : +1 row, {len(rows)} total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
