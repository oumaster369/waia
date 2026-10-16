#!/usr/bin/env bash
# Установка OB-HEATMAP на сервер сбора. Не трогает waia-binance-collect,
# waia-binance-serve (:8787) и существующий туннель Cloudflare.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "запускать от root: sudo bash obheat/deploy/install.sh" >&2
  exit 1
fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/obheat/app
PY=python3.12

if ! command -v "$PY" >/dev/null 2>&1; then
  echo "нужен python3.12" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3.12-venv python3.12-dev build-essential

if ! id obheat >/dev/null 2>&1; then
  useradd --system --home /srv/obheat --shell /usr/sbin/nologin obheat
fi

install -d -m 0755 /opt/obheat /srv/obheat/data /srv/obheat/live
rm -rf "$APP/obheat"
mkdir -p "$APP"
cp -a "$SRC" "$APP/obheat"

"$PY" -m venv /opt/obheat/venv
/opt/obheat/venv/bin/pip install --upgrade pip
/opt/obheat/venv/bin/pip install -r "$SRC/requirements.txt"

chown -R obheat:obheat /opt/obheat /srv/obheat

cp "$SRC/deploy/obheat-collect.service" /etc/systemd/system/obheat-collect.service
cp "$SRC/deploy/obheat-serve.service" /etc/systemd/system/obheat-serve.service
if [[ ! -f /etc/obheat.env ]]; then
  cp "$SRC/deploy/obheat.env.example" /etc/obheat.env
fi
chown root:obheat /etc/obheat.env
chmod 640 /etc/obheat.env

systemctl daemon-reload
systemctl enable obheat-collect.service obheat-serve.service

echo "установлено в /opt/obheat, данные в /srv/obheat, порт 8790."
echo "проверьте /etc/obheat.env и запустите:"
echo "  systemctl start obheat-collect.service obheat-serve.service"
