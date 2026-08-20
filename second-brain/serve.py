#!/usr/bin/env python3
"""
serve.py - the second brain's interface. One file, standard library only.

    python serve.py            # starts on http://127.0.0.1:7432 and opens it
    python serve.py --no-open  # just start
    python serve.py --port N

Sits next to q.py and wraps it behind a tiny localhost API. Queries go through
q.py --json so the UI sees exactly what a session would see — same scorer, same
refusals, same confidence codes. Index reads import brainlib directly, which is
why stats and "surprise me" cost no subprocess.

Binds 127.0.0.1 only. Never expose this beyond localhost: it reads your files.
"""

import argparse
import json
import random
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

try:
    import brainlib
except ImportError:
    print("serve.py must live next to brainlib.py — put it in the second-brain folder.",
          file=sys.stderr)
    sys.exit(1)

INDEX = HERE / "index.tsv"
UI = HERE / "ui.html"
PORT_DEFAULT = 7432
ALLOWED_HOSTS = {"127.0.0.1", "localhost"}

# One reindex at a time; a second request while one runs gets told to wait.
_reindex_lock = threading.Lock()


def installed() -> bool:
    return INDEX.is_file() and (HERE / "brain.json").is_file()


def run_tool(args, timeout=120):
    """Run a sibling script with the same interpreter, UTF-8 forced.

    Windows consoles default to cp1252; without PYTHONIOENCODING a note
    containing an arrow or an em dash crashes the child, and the UI would
    report a working brain as broken.
    """
    import os
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    p = subprocess.run([sys.executable, *args], cwd=str(HERE),
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout, env=env)
    return p.returncode, p.stdout, p.stderr


def read_rows():
    _, rows = brainlib.read_index(INDEX)
    return rows


def state():
    if not installed():
        return {"installed": False}
    cfg = brainlib.load_config(HERE)
    rows = read_rows()
    kinds, folders = {}, {}
    mem_rows = 0
    roots = [brainlib.norm(r) for r in cfg.get("roots", [])]
    for r in rows:
        kinds[r.kind] = kinds.get(r.kind, 0) + 1
        if "/memories/" in r.path or r.path.startswith(str(HERE).replace("\\", "/")):
            mem_rows += 1
        top = r.path
        for root in roots:
            if top.startswith(root):
                rel = top[len(root):].lstrip("/")
                top = (Path(root).name + "/" + rel.split("/")[0]) if "/" in rel else Path(root).name
                break
        folders[top] = folders.get(top, 0) + 1
    memories = []
    mdir = HERE / "memories"
    if mdir.is_dir():
        for f in sorted(mdir.glob("*.md"), reverse=True)[:3]:
            txt = f.read_text(encoding="utf-8", errors="replace")
            for m in reversed(list(__import__("re").finditer(
                    r"^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$", txt, __import__("re").M))):
                memories.append({"date": m.group(1), "kind": m.group(2),
                                 "title": m.group(3).strip()})
                if len(memories) >= 12:
                    break
            if len(memories) >= 12:
                break
    top_folders = sorted(folders.items(), key=lambda kv: -kv[1])[:8]
    return {
        "installed": True,
        "sections": len(rows),
        "kinds": kinds,
        "folders": [{"name": k, "n": v} for k, v in top_folders],
        "index_kb": round(INDEX.stat().st_size / 1024, 1),
        "memories": memories,
        "memory_rows": mem_rows,
        "roots": [{"path": r, "weight": cfg.get("context", {}).get(r, {}).get("weight", 1.0)}
                  for r in cfg.get("roots", [])],
    }


def query(body):
    q = (body.get("q") or "").strip()
    if not q:
        return {"status": "error", "text": "Empty question."}
    args = ["q.py", *q.split(), "--json"]
    if body.get("full"):
        args.append("--full")
    if body.get("cap") in ("brief", "normal", "wide"):
        args += ["--cap", body["cap"]]
    scope = (body.get("scope") or "").strip()
    if scope:
        args += ["--scope", scope]
    t0 = time.time()
    try:
        rc, out, err = run_tool(args, timeout=60)
    except subprocess.TimeoutExpired:
        return {"status": "error", "text": "Query exceeded 60s — the index may need a reindex."}
    out = out.strip()
    if out.startswith("{"):
        try:
            d = json.loads(out)
            d["wall_ms"] = round((time.time() - t0) * 1000)
            return d
        except json.JSONDecodeError:
            pass
    # Refusals and errors arrive as plain text on stdout or stderr. That is the
    # brain being honest — surface the words, don't dress them as a crash.
    text = out or err.strip() or f"q.py exited {rc} with no output."
    return {"status": "refused" if rc != 0 else "message", "text": text,
            "wall_ms": round((time.time() - t0) * 1000)}


def remember(body):
    text = (body.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "Nothing to remember."}
    kind = body.get("kind", "fact")
    if kind not in ("decision", "pref", "gotcha", "fact"):
        return {"ok": False, "error": f"Unknown kind {kind!r}."}
    args = ["remember.py", text, "--kind", kind]
    tags = (body.get("tags") or "").strip()
    if tags:
        args += ["--tags", tags]
    rc, out, err = run_tool(args, timeout=30)
    if rc != 0:
        return {"ok": False, "error": (err or out).strip()}
    total = None
    m = __import__("re").search(r"(\d+) total", out)
    if m:
        total = int(m.group(1))
    return {"ok": True, "message": out.strip().splitlines()[0], "total_rows": total}


def reindex():
    if not _reindex_lock.acquire(blocking=False):
        return {"ok": False, "error": "A reindex is already running."}
    try:
        rc, out, err = run_tool(["idx.py", "--stats"], timeout=600)
        return {"ok": rc == 0, "output": (out + ("\n" + err if err.strip() else "")).strip()}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Reindex exceeded 10 minutes."}
    finally:
        _reindex_lock.release()


def surprise():
    """A random section — rediscovery is the fun half of a memory system."""
    rows = [r for r in read_rows() if r.byte_end - r.byte_start > 80]
    if not rows:
        return {"ok": False, "error": "Index is empty."}
    for _ in range(6):                      # tolerate a moved file
        r = random.choice(rows)
        try:
            body = brainlib.slice_bytes(r.path, r.byte_start, r.byte_end)
            return {"ok": True, "path": r.path, "heading": r.heading,
                    "kind": r.kind, "confidence": r.confidence,
                    "body": body[:4000]}
        except OSError:
            continue
    return {"ok": False, "error": "Could not read a section — try a reindex."}


class Handler(BaseHTTPRequestHandler):
    server_version = "brain-ui/1.0"

    def _guard(self) -> bool:
        # DNS-rebinding defence: a hostile page can point its own hostname at
        # 127.0.0.1 and script requests here; checking Host shuts that door.
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        if host not in ALLOWED_HOSTS:
            self.send_error(403, "bad host")
            return False
        return True

    def _json(self, obj, code=200):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not self._guard():
            return
        route = self.path.split("?")[0]
        if route in ("/", "/index.html"):
            try:
                raw = UI.read_bytes()
            except OSError:
                self.send_error(500, "ui.html missing next to serve.py")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        elif route == "/api/state":
            self._json(state())
        elif route == "/api/surprise":
            self._json(surprise())
        else:
            self.send_error(404)

    def do_POST(self):
        if not self._guard():
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except (ValueError, json.JSONDecodeError):
            self._json({"error": "bad json"}, 400)
            return
        route = self.path.split("?")[0]
        if route == "/api/query":
            self._json(query(body))
        elif route == "/api/remember":
            self._json(remember(body))
        elif route == "/api/reindex":
            self._json(reindex())
        else:
            self.send_error(404)

    def log_message(self, fmt, *args):   # quiet console
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT_DEFAULT)
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = f"http://127.0.0.1:{a.port}"
    print(f"brain-ui  {url}")
    print(f"  brain   {'installed, ' + str(sum(1 for _ in open(INDEX, encoding='utf-8')) - 1) + ' sections' if installed() else 'NOT INSTALLED — the page will show install steps'}")
    print("  ctrl-c to stop")
    if not a.no_open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
