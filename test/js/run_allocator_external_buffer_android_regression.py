#!/usr/bin/env python3
"""Run allocator-owned external-buffer regressions in isolated Bun processes."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


EXPECTED = {
    "buffer": {
        "utf8Hex": "636166c3a920f09f8c8d",
        "hex": "hello",
        "base64": "hello",
        "empty": 0,
        "malformedHex": 0,
        "malformedBase64": 0,
    },
    "subprocess": {"exitCode": 0, "stdout": "spawn-out", "stderr": "spawn-err"},
    "shell": {"stdout": "shell-output", "bytes": 12, "text": "shell-output", "blobText": "shell-output"},
    "terminal": {"exitCode": 0, "output": "terminal-output"},
    "filesystem": {"sync": "filesystem-output", "async": "filesystem-output", "callback": "filesystem-output"},
    "crypto": {"hex": "120fb6cffcf8b32c43e7225256c4f837a86548c9"},
}


def run_case(bun: Path, test: Path, case: str) -> None:
    # A separate process is required because a crash in one external finalizer
    # must not be hidden by buffers retained by another case.
    completed = subprocess.run(
        [str(bun), str(test), case],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    result_lines = [line for line in completed.stdout.splitlines() if line.startswith("RESULT ")]
    if not result_lines:
        raise AssertionError(f"{case}: missing RESULT; rc={completed.returncode}\n{completed.stdout}\n{completed.stderr}")

    result = json.loads(result_lines[0][len("RESULT ") :])
    if result != EXPECTED[case]:
        raise AssertionError(f"{case}: unexpected result: {result!r}")
    if completed.returncode != 0:
        raise AssertionError(f"{case}: Bun exited {completed.returncode}\n{completed.stdout}\n{completed.stderr}")
    if f"TIMER_OK {case}" not in completed.stdout:
        raise AssertionError(f"{case}: timer marker missing\n{completed.stdout}\n{completed.stderr}")

    print(f"PASS allocator external-buffer {case}")


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} /path/to/bun")

    bun = Path(sys.argv[1])
    test = Path(__file__).with_name("allocator_external_buffer_android.regression.mjs")
    for case in EXPECTED:
        run_case(bun, test, case)
    print("PASS allocator external-buffer matrix")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
