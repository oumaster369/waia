#!/usr/bin/env python3
"""OpenSSH argv + raw stdin emulator for T4A PRE_AUTH live-transport tests."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from typing import Any


def parse_ssh_argv(argv: list[str]) -> tuple[str, list[str]]:
    args = argv[1:]
    index = 0
    while index < len(args):
        if args[index] == "-o":
            index += 2
            continue
        break
    if index >= len(args):
        raise SystemExit("fake-ssh: missing ssh target")
    target = args[index]
    index += 1
    remote_parts = args[index:]
    return target, remote_parts


def reconstruct_remote_command(remote_parts: list[str]) -> str:
    if len(remote_parts) == 1:
        return remote_parts[0]
    if not remote_parts:
        return ""
    return " ".join(remote_parts)


def main() -> None:
    log_path = os.environ["FHV_FAKE_SSH_LOG"]
    foreign_cwd = os.environ["FHV_FAKE_SSH_FOREIGN_CWD"]
    stub_bin = os.environ.get("FHV_FAKE_SSH_STUB_BIN", "")

    stdin_bytes = sys.stdin.buffer.read()
    stdin_present = len(stdin_bytes) > 0
    stdin_sha256 = hashlib.sha256(stdin_bytes).hexdigest() if stdin_present else None

    target, remote_parts = parse_ssh_argv(sys.argv)
    remote_command = reconstruct_remote_command(remote_parts)

    env = os.environ.copy()
    if stub_bin:
        env["PATH"] = f"{stub_bin}:{env.get('PATH', '')}"

    if len(remote_parts) == 1:
        completed = subprocess.run(
            ["bash", "-c", remote_parts[0]],
            input=stdin_bytes if stdin_present else None,
            cwd=foreign_cwd,
            env=env,
            capture_output=True,
        )
    elif len(remote_parts) > 1:
        completed = subprocess.run(
            remote_parts,
            input=stdin_bytes if stdin_present else None,
            cwd=foreign_cwd,
            env=env,
            capture_output=True,
        )
    else:
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b"")

    if completed.stdout:
        sys.stdout.buffer.write(completed.stdout)
    if completed.stderr:
        sys.stderr.buffer.write(completed.stderr)

    record: dict[str, Any] = {
        "argv": sys.argv[1:],
        "target": target,
        "remoteParts": remote_parts,
        "remoteCommand": remote_command,
        "stdinPresent": stdin_present,
        "stdinByteLength": len(stdin_bytes),
        "stdinSha256": stdin_sha256,
        "exitStatus": completed.returncode,
    }
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, separators=(",", ":")) + "\n")

    raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
