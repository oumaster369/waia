#!/usr/bin/env bash
# DEE-436 — read-only host probe JSON for trader:fhv:t4:verify-rollback / verify-ceremony.
# Does not mutate systemd or Docker.
set -euo pipefail

CAMPAIGN_UNIT="${FHV_SYSTEMD_CAMPAIGN_UNIT:-waia-fhv-campaign.service}"
OBSERVER_UNIT="${FHV_SYSTEMD_OBSERVER_UNIT:-waia-fhv-observer.service}"
LEGACY_NAME="${FHV_SYSTEMD_LEGACY_CONTAINER_NAME:-ai-trader-execution-host}"
INSTALLED_DIR="${FHV_INSTALLED_UNITS_DIR:-/etc/systemd/system}"

export CAMPAIGN_UNIT OBSERVER_UNIT LEGACY_NAME INSTALLED_DIR

python3 - <<'PY'
import json
import os
import subprocess

campaign = os.environ["CAMPAIGN_UNIT"]
observer = os.environ["OBSERVER_UNIT"]
legacy_name = os.environ["LEGACY_NAME"]
installed_dir = os.environ["INSTALLED_DIR"]

def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, (proc.stdout or "").strip()

def active_state(unit: str) -> str:
    code, out = run(["systemctl", "is-active", unit])
    if out in {"active", "inactive", "failed", "activating", "deactivating", "reloading"}:
        return out
    if not os.path.exists(os.path.join(installed_dir, unit)):
        return "not-found"
    return out or "unknown"

def enabled_state(unit: str) -> str:
    code, out = run(["systemctl", "is-enabled", unit])
    if out in {
        "enabled",
        "disabled",
        "static",
        "masked",
        "alias",
        "indirect",
        "generated",
        "transient",
        "enabled-runtime",
    }:
        return out
    if not os.path.exists(os.path.join(installed_dir, unit)):
        return "not-found"
    return out or "unknown"

def unit_exists(unit: str) -> bool:
    return os.path.exists(os.path.join(installed_dir, unit))

proc = subprocess.run(["ps", "-eo", "args="], capture_output=True, text=True)
patterns = ("fhv-campaign-cli", "fhv-observer-cli", "waia-fhv-campaign", "waia-fhv-observer")
processes = [
    line.strip()
    for line in (proc.stdout or "").splitlines()
    if line.strip() and any(p in line for p in patterns)
]

legacy = None
docker = subprocess.run(["bash", "-lc", "command -v docker"], capture_output=True, text=True)
if docker.returncode == 0:
    running = run(["docker", "inspect", "-f", "{{.State.Running}}", legacy_name])[1]
    image = run(["docker", "inspect", "-f", "{{.Config.Image}}", legacy_name])[1]
    if running and image:
        legacy = {
            "name": legacy_name,
            "image": image,
            "running": running == "true",
        }

boot_id = None
try:
    boot_id = open("/proc/sys/kernel/random/boot_id", "r", encoding="utf-8").read().strip()
except OSError:
    boot_id = None

payload = {
    "active": {campaign: active_state(campaign), observer: active_state(observer)},
    "enabled": {campaign: enabled_state(campaign), observer: enabled_state(observer)},
    "unitFiles": {campaign: unit_exists(campaign), observer: unit_exists(observer)},
    "processes": processes,
    "legacy": legacy,
    "hostBootId": boot_id,
}
print(json.dumps(payload, indent=2))
PY
