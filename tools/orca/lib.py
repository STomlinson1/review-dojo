"""Shared parsing for the Orca helper scripts in this directory."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


def orca(*args: str) -> dict:
    out = subprocess.run(["orca", *args, "--json"], capture_output=True, text=True).stdout
    documents = [line for line in out.splitlines() if '"_keepalive"' not in line]
    # Orca can emit raw control characters inside JSON strings, which a strict parser (and jq) rejects.
    return json.loads("\n".join(documents), strict=False)


def main_checkout() -> Path:
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return Path(common).parent


def session_cost(handle: str) -> str | None:
    """The dollar figure on the terminal's Claude Code status line, or None when it cannot be read."""
    result = orca("terminal", "read", "--terminal", handle).get("result") or {}
    terminal = result.get("terminal") or result
    amounts = re.findall(r"\$(\d+\.\d{2})", "\n".join(terminal.get("tail") or []))
    return amounts[-1] if amounts else None


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)
