"""
Skill launcher -- runs Claude Code skills headlessly from buttons.

Stdlib only. Python 3.13 on Windows, PowerShell 5.1.
Start it with start-launcher.ps1, or:  python launcher.py

Most buttons shell out to `claude -p "<prompt>"` with a fixed command line
(fire-and-forget: no pickers, no input fields). A button with a "cmd" instead of
a "prompt" runs that plain command, no model involved. Edit the SKILLS table below
to change what a button runs -- that table is the only thing you should need to touch.
"""

import http.server
import json
import os
import re
import socketserver
import subprocess
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

PORT = 8787

# Everything runs with this as the working directory so that
# Projects/CLAUDE.md loads and the skills can see the repos.
#   launcher.py -> launcher -> apps -> OS -> second-brain -> Projects
ROOT = Path(__file__).resolve().parents[4]      # ...\Downloads\Projects
HERE = Path(__file__).resolve().parent          # ...\OS\apps\launcher
OS_DIR = HERE.parents[1]                        # ...\second-brain\OS
RUNS_DIR = HERE / "runs"
RUNS_LOG = HERE / "runs.log"
SKILLS_DIR = Path.home() / ".claude" / "skills"

# Headless runs cannot answer a permission prompt -- they would hang forever.
# bypassPermissions is what makes fire-and-forget actually fire. It means these
# skills can write files without asking, so keep this table to skills you trust.
PERMISSION_MODE = "bypassPermissions"

SKILLS = [
    {
        "id": "home",
        "label": "Rebuild home",
        "cmd": f'python "{OS_DIR / "build_home.py"}" --open',
        "blurb": "Regenerates HOME.html and SKILLS.html from disk and opens them. No model, free",
    },
    {
        "id": "clean-up",
        "label": "Clean up",
        "prompt": "/clean-up",
        "model": "fable",
        "effort": "xhigh",
        "blurb": "Kill stray headless browsers and drivers, free temp, report disk",
    },
    {
        "id": "doctor-plus",
        "label": "Doctor plus",
        "prompt": "/doctor-plus. This is a headless run with nobody to approve fixes: "
                  "print the findings table and change nothing.",
        "model": "claude-opus-5",
        "effort": None,
        "blurb": "Claude Code health check plus a context audit. Report only, changes nothing",
    },
    {
        "id": "upkeep",
        "label": "Weekly upkeep",
        # A plain prompt, not a slash command: the routine is a file, not a skill.
        "prompt": "Run the weekly upkeep routine in second-brain/OS/routines/weekly-upkeep.md "
                  "step by step, then print its 'What comes out' list.",
        "model": "claude-opus-5",
        "effort": None,
        "blurb": "Prune memory, promote repeats, reindex the brain, rebuild HOME.html",
    },
    {
        "id": "generate",
        "label": "Generate visuals",
        "prompt": "/generate every unchecked item in second-brain/OS/apps/launcher/generate-queue.md, "
                  "images only, one at a time. After each save, tick that item and append the "
                  "saved filename. Skip video items: they need a quoted cost and an explicit go, "
                  "which this headless run cannot get. If nothing is unchecked, say so and stop.",
        "model": "claude-opus-5",
        "effort": None,
        "blurb": "Works through generate-queue.md next to this file. Images only; video needs a chat",
    },
    {
        "id": "gauntlet-loop",
        "label": "Gauntlet Blueberry",
        "prompt": "/gauntlet-loop the newest open work in "
                  "grignard/grignard-app-source/documentation/STATUS.md. This is a headless run "
                  "with nobody to answer questions: pick the bar yourself, say why in one line, "
                  "and print the finished prompt.",
        "model": "claude-opus-5",
        "effort": None,
        "blurb": "Turns the newest STATUS.md work into a paste-ready gauntlet prompt",
    },
]

SKILLS_BY_ID = {s["id"]: s for s in SKILLS}

# --------------------------------------------------------------------------
# Run state
# --------------------------------------------------------------------------

_state_lock = threading.Lock()
# id -> {status, started, finished, exit, log, pid}
_runs = {s["id"]: {"status": "idle"} for s in SKILLS}


def _stamp():
    return datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")


def _log_line(text):
    RUNS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with RUNS_LOG.open("a", encoding="utf-8") as fh:
        fh.write(text.rstrip() + "\n")
    print(text.rstrip(), flush=True)


def _missing_skill(skill):
    """The slash command a button needs but this machine does not have, else None.

    `claude -p "/nope"` prints "Unknown command" and still exits 0, so without this
    check a button for a skill that does not exist reports "done". That is how the
    old /morning and /arms buttons looked green while doing nothing.
    """
    prompt = skill.get("prompt", "")
    if not prompt.startswith("/"):
        return None
    name = prompt[1:].split()[0]
    return None if (SKILLS_DIR / name / "SKILL.md").is_file() else "/" + name


def _build_command(skill):
    if skill.get("cmd"):
        return skill["cmd"]
    parts = ["claude", "-p", f'"{skill["prompt"]}"']
    if skill.get("model"):
        parts += ["--model", skill["model"]]
    if skill.get("effort"):
        parts += ["--effort", skill["effort"]]
    parts += ["--permission-mode", PERMISSION_MODE]
    return " ".join(parts)


def _run_skill(skill):
    """Run one skill to completion in a background thread."""
    sid = skill["id"]
    started = time.time()
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = RUNS_DIR / f"{datetime.now():%Y-%m-%d_%H%M%S}-{sid}.log"
    command = _build_command(skill)

    with _state_lock:
        _runs[sid] = {
            "status": "running",
            "started": _stamp(),
            "log": str(log_path),
        }

    _log_line(f"{_stamp()}  {sid:<14} started   {command}")

    exit_code = -1
    try:
        with log_path.open("w", encoding="utf-8", errors="replace") as out:
            out.write(f"$ {command}\n\n")
            out.flush()
            # shell=True because on Windows `claude` is a .cmd shim that
            # CreateProcess cannot execute directly. Safe here: every command
            # is built from the fixed SKILLS table, never from user input.
            proc = subprocess.Popen(
                command,
                cwd=str(ROOT),
                shell=True,
                stdout=out,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
            )
            with _state_lock:
                _runs[sid]["pid"] = proc.pid
            exit_code = proc.wait()
    except Exception as exc:  # noqa: BLE001 - surface anything to the log
        exit_code = -1
        with log_path.open("a", encoding="utf-8") as out:
            out.write(f"\n[launcher] failed to start: {exc!r}\n")

    secs = int(time.time() - started)
    status = "done" if exit_code == 0 else "failed"

    with _state_lock:
        _runs[sid].update(
            {
                "status": status,
                "finished": _stamp(),
                "exit": exit_code,
                "seconds": secs,
                "log": str(log_path),
            }
        )

    _log_line(
        f"{_stamp()}  {sid:<14} {status:<9} exit={exit_code}  {secs}s  {log_path.name}"
    )


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

INDEX = HERE / "index.html"


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # the run log is the log; keep the console quiet

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            try:
                html = INDEX.read_text(encoding="utf-8")
            except OSError:
                return self._send(500, "index.html is missing next to launcher.py",
                                  "text/plain; charset=utf-8")
            return self._send(200, html, "text/html; charset=utf-8")

        if self.path == "/skills":
            payload = [
                {k: s.get(k) for k in ("id", "label", "blurb", "model", "effort")}
                | {"command": _build_command(s), "missing": _missing_skill(s)}
                for s in SKILLS
            ]
            return self._send(200, json.dumps(payload))

        if self.path == "/runs":
            with _state_lock:
                return self._send(200, json.dumps(_runs))

        # The latest run's full output, so the result is one click away, not a file hunt.
        match = re.fullmatch(r"/log/([a-zA-Z0-9_-]+)", self.path)
        if match:
            with _state_lock:
                log = _runs.get(match.group(1), {}).get("log")
            if not log:
                return self._send(404, "no run yet this session", "text/plain; charset=utf-8")
            try:
                text = Path(log).read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                return self._send(500, f"could not read {log}: {exc}", "text/plain; charset=utf-8")
            return self._send(200, text, "text/plain; charset=utf-8")

        return self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        match = re.fullmatch(r"/run/([a-zA-Z0-9_-]+)", self.path)
        if not match:
            return self._send(404, json.dumps({"error": "not found"}))

        sid = match.group(1)
        skill = SKILLS_BY_ID.get(sid)
        if skill is None:
            return self._send(404, json.dumps({"error": f"no skill {sid!r}"}))
        missing = _missing_skill(skill)
        if missing:
            return self._send(409, json.dumps({"error": f"{missing} is not installed"}))

        with _state_lock:
            if _runs[sid].get("status") == "running":
                return self._send(409, json.dumps({"error": "already running"}))
            _runs[sid] = {"status": "running", "started": _stamp()}

        threading.Thread(target=_run_skill, args=(skill,), daemon=True).start()
        return self._send(202, json.dumps({"ok": True, "id": sid}))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    os.chdir(HERE)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    url = f"http://127.0.0.1:{PORT}/"

    print(f"Skill launcher on {url}")
    print(f"  working directory for every run : {ROOT}")
    print(f"  run log                         : {RUNS_LOG}")
    print("  Ctrl+C to stop.\n")

    # 127.0.0.1, not 0.0.0.0 -- this shells out to a coding agent with
    # permissions bypassed, so it must not be reachable from the network.
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
