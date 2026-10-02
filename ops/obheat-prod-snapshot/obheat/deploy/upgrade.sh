#!/usr/bin/env bash
# Idempotent upgrade for an existing OB-HEATMAP server install.
# Keeps /srv/obheat data and /etc/obheat.env.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash obheat/deploy/upgrade.sh" >&2
  exit 1
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/obheat/app
PY="${OBHEAT_PYTHON:-python3.12}"

if ! command -v "$PY" >/dev/null 2>&1; then
  echo "missing $PY" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3.12-venv python3.12-dev build-essential

if ! id obheat >/dev/null 2>&1; then
  useradd --system --home /srv/obheat --shell /usr/sbin/nologin obheat
fi

install -d -m 0755 /opt/obheat /srv/obheat/data /srv/obheat/live
mkdir -p "$APP"
rm -rf "$APP/obheat"
cp -a "$SRC" "$APP/obheat"

"$PY" -m venv /opt/obheat/venv
/opt/obheat/venv/bin/pip install --upgrade pip
/opt/obheat/venv/bin/pip install -r "$SRC/requirements.txt"

if [[ ! -f /etc/obheat.env ]]; then
  cp "$SRC/deploy/obheat.env.example" /etc/obheat.env
fi

append_env() {
  local key="$1"
  local value="$2"
  if ! grep -qE "^${key}=" /etc/obheat.env; then
    printf '%s=%s\n' "$key" "$value" >>/etc/obheat.env
  fi
}

append_env OBHEAT_DATA /srv/obheat
append_env OBHEAT_BIND 127.0.0.1
append_env OBHEAT_PORT 8790
append_env OBHEAT_LOG_LEVEL INFO
append_env OBHEAT_SYMBOLS BTCUSDT,ETHUSDT
append_env OBHEAT_VENUES BINANCE,BYBIT,OKX,HTX,BITGET,GATE,BINANCE_SPOT,COINBASE,OKX_SPOT,BYBIT_SPOT

cp "$SRC/deploy/obheat-collect.service" /etc/systemd/system/obheat-collect.service
cp "$SRC/deploy/obheat-serve.service" /etc/systemd/system/obheat-serve.service
chown -R obheat:obheat /opt/obheat /srv/obheat
chown root:obheat /etc/obheat.env
chmod 640 /etc/obheat.env

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable obheat-collect.service obheat-serve.service
  systemctl restart obheat-collect.service obheat-serve.service
  systemctl --no-pager --full status obheat-collect.service obheat-serve.service || true
fi

echo "OB-HEATMAP upgraded. Data preserved in /srv/obheat; env preserved in /etc/obheat.env."
