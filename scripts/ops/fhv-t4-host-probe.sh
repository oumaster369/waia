#!/usr/bin/env bash
# DEE-436 — read-only host probe JSON for deployment / post-rollback verification.
# Does not mutate systemd or Docker. Requires explicit tool bindings.
set -euo pipefail

PYTHON_BIN=""
SYSTEMCTL_BIN=""
DOCKER_BIN=""
INSTALLED_UNITS_DIR=""
OUTPUT_PATH=""
CAMPAIGN_UNIT="waia-fhv-campaign.service"
OBSERVER_UNIT="waia-fhv-observer.service"
LEGACY_NAME="ai-trader-execution-host"

usage() {
  cat >&2 <<'EOF'
Usage: fhv-t4-host-probe.sh --python-bin PATH --systemctl-bin PATH --docker-bin PATH \
  --installed-units-dir DIR [--output PATH] [--campaign-unit NAME] [--observer-unit NAME] \
  [--legacy-container-name NAME]

Emits JSON host probe to stdout or --output file. Read-only.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --python-bin) PYTHON_BIN="${2:-}"; shift 2 ;;
    --systemctl-bin) SYSTEMCTL_BIN="${2:-}"; shift 2 ;;
    --docker-bin) DOCKER_BIN="${2:-}"; shift 2 ;;
    --installed-units-dir) INSTALLED_UNITS_DIR="${2:-}"; shift 2 ;;
    --output) OUTPUT_PATH="${2:-}"; shift 2 ;;
    --campaign-unit) CAMPAIGN_UNIT="${2:-}"; shift 2 ;;
    --observer-unit) OBSERVER_UNIT="${2:-}"; shift 2 ;;
    --legacy-container-name) LEGACY_NAME="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || die "--python-bin required and must be executable"
[[ -n "$SYSTEMCTL_BIN" && -x "$SYSTEMCTL_BIN" ]] || die "--systemctl-bin required and must be executable"
[[ -n "$DOCKER_BIN" && -x "$DOCKER_BIN" ]] || die "--docker-bin required and must be executable"
[[ -n "$INSTALLED_UNITS_DIR" && -d "$INSTALLED_UNITS_DIR" ]] || die "--installed-units-dir required and must exist"

export CAMPAIGN_UNIT OBSERVER_UNIT LEGACY_NAME INSTALLED_UNITS_DIR SYSTEMCTL_BIN DOCKER_BIN

JSON="$("$PYTHON_BIN" - <<'PY'
import json
import os
import subprocess

campaign = os.environ["CAMPAIGN_UNIT"]
observer = os.environ["OBSERVER_UNIT"]
legacy_name = os.environ["LEGACY_NAME"]
installed_dir = os.environ["INSTALLED_UNITS_DIR"]
systemctl = os.environ["SYSTEMCTL_BIN"]
docker = os.environ["DOCKER_BIN"]

def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, (proc.stdout or "").strip()

def active_state(unit: str) -> str:
    code, out = run([systemctl, "is-active", unit])
    if out in {"active", "inactive", "failed", "activating", "deactivating", "reloading"}:
        return out
    if not os.path.exists(os.path.join(installed_dir, unit)):
        return "not-found"
    return out or "unknown"

def enabled_state(unit: str) -> str:
    code, out = run([systemctl, "is-enabled", unit])
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

patterns = ("fhv-campaign-cli", "fhv-observer-cli", "waia-fhv-campaign", "waia-fhv-observer")
processes: list[str] = []
for entry in os.scandir("/proc"):
    if not entry.name.isdigit():
        continue
    try:
        with open(os.path.join(entry.path, "cmdline"), "rb") as handle:
            raw = handle.read().replace(b"\0", b" ").decode("utf-8", errors="replace").strip()
    except OSError:
        continue
    if raw and any(p in raw for p in patterns):
        processes.append(raw)

legacy = None
inspect = run([docker, "inspect", "-f", "{{.State.Running}} {{.Config.Image}}", legacy_name])
if inspect[0] == 0 and inspect[1]:
    parts = inspect[1].split(" ", 1)
    if len(parts) == 2:
        running_raw, image = parts
        legacy = {
            "name": legacy_name,
            "image": image,
            "running": running_raw == "true",
        }

boot_id = None
try:
    with open("/proc/sys/kernel/random/boot_id", "r", encoding="utf-8") as handle:
        boot_id = handle.read().strip()
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
)"

if [[ -n "$OUTPUT_PATH" ]]; then
  printf '%s\n' "$JSON" >"$OUTPUT_PATH"
else
  printf '%s\n' "$JSON"
fi
