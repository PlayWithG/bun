#!/usr/bin/env python3
"""External runner for the Android/Bionic spawnSync regression."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} /path/to/bun")

    bun = Path(sys.argv[1])
    test = Path(__file__).with_name("spawn_sync_maxbuffer_android.regression.mjs")
    completed = subprocess.run(
        [str(bun), str(test), "repro"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )

    lines = completed.stdout.splitlines()
    if not lines:
        raise AssertionError(f"Bun produced no stdout; rc={completed.returncode}\n{completed.stderr}")

    result = json.loads(lines[0])
    if result != {
        "mode": "repro",
        "exitCode": 0,
        "stdoutBytes": 6,
        "stderrBytes": 0,
    }:
        raise AssertionError(f"unexpected spawnSync result: {result!r}")
    if completed.returncode != 0:
        raise AssertionError(f"Bun exited {completed.returncode}\n{completed.stderr}")
    if "TIMER_OK repro" not in completed.stdout:
        raise AssertionError(f"timer marker missing\n{completed.stdout}\n{completed.stderr}")

    print("PASS external spawnSync Android regression")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
