#!/usr/bin/env bash
# Drop-in upgrade of the production OB-HEATMAP tree.
# Replaces /opt/obheat/app/obheat, pip-installs into /opt/obheat/venv,
# restarts collect then serve, and restores the previous tree if health fails.
# Does not print OBHEAT_TOKEN and does not rewrite /etc/obheat.env.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash obheat/deploy/upgrade.sh" >&2
  exit 1
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/obheat/app
VENV=/opt/obheat/venv
TS="$(date -u +%Y%m%d%H%M%S)"
BAK="/root/obheat-app-bak-${TS}.tgz"
ROLLBACK=0

rollback() {
  if [[ "$ROLLBACK" -eq 1 ]]; then
    return
  fi
  ROLLBACK=1
  echo "upgrade failed; restoring ${BAK}" >&2
  systemctl stop obheat-serve.service obheat-collect.service || true
  rm -rf "$APP"
  tar -C /opt/obheat -xzf "$BAK"
  if [[ -x "$VENV/bin/pip" && -f "$APP/obheat/requirements.txt" ]]; then
    "$VENV/bin/pip" install -r "$APP/obheat/requirements.txt"
  fi
  chown -R obheat:obheat /opt/obheat || true
  systemctl start obheat-collect.service || true
  systemctl start obheat-serve.service || true
  echo "rolled back to ${BAK}" >&2
  exit 1
}
trap rollback ERR

if [[ ! -d "$APP/obheat" ]]; then
  echo "missing $APP/obheat — use install.sh for a first install" >&2
  exit 1
fi
if [[ ! -x "$VENV/bin/pip" ]]; then
  echo "missing $VENV — production venv is required" >&2
  exit 1
fi

mkdir -p /root
tar -C /opt/obheat -czf "$BAK" app
echo "backup ${BAK}"

rm -rf "$APP/obheat"
cp -a "$SRC" "$APP/obheat"
"$VENV/bin/pip" install -r "$SRC/requirements.txt"
chown -R obheat:obheat /opt/obheat

systemctl daemon-reload || true
systemctl restart obheat-collect.service
sleep 2
if ! systemctl is-active --quiet obheat-collect.service; then
  echo "obheat-collect did not stay up" >&2
  rollback
fi
systemctl restart obheat-serve.service
sleep 2
if ! systemctl is-active --quiet obheat-serve.service; then
  echo "obheat-serve did not stay up" >&2
  rollback
fi

set -a
# shellcheck disable=SC1091
source /etc/obheat.env
set +a
PORT="${OBHEAT_PORT:-8790}"
HDR=()
if [[ -n "${OBHEAT_TOKEN:-}" ]]; then
  HDR=(-H "Authorization: Bearer ${OBHEAT_TOKEN}")
fi
CODE="$(curl -sS -o /tmp/obheat-upgrade-health.json -w "%{http_code}" --max-time 15 "${HDR[@]}" "http://127.0.0.1:${PORT}/health" || true)"
if [[ "$CODE" != "200" ]]; then
  echo "health check HTTP ${CODE}" >&2
  rollback
fi
python3 - << 'PY'
import json
body = json.load(open("/tmp/obheat-upgrade-health.json", encoding="utf-8"))
if "venues" not in body and body.get("ok") is not True:
    raise SystemExit("health payload missing venues")
print("health ok, venues", ",".join(sorted((body.get("venues") or {}))))
PY
rm -f /tmp/obheat-upgrade-health.json
trap - ERR
echo "OB-HEATMAP upgraded. Backup kept at ${BAK}. Data in /srv/obheat was not touched."
