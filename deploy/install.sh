#!/usr/bin/env bash
# Установка на Raspberry Pi: виртуальное окружение + systemd-сервис.
#   ./deploy/install.sh              — поставить зависимости и включить сервис
#   ./deploy/install.sh --no-service — только зависимости (запуск вручную)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { echo "Нужен Python 3.10+"; exit 1; }
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
mkdir -p data

if [[ "${1:-}" == "--no-service" ]]; then
  echo "Готово. Запуск:  YACAL_DATA=$DIR/data $DIR/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080"
  exit 0
fi

sed -e "s|__USER__|$(id -un)|g" -e "s|__DIR__|$DIR|g" deploy/yacal.service | sudo tee /etc/systemd/system/yacal.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now yacal
sleep 2
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Готово. Откройте в браузере: http://${IP:-<IP-малины>}:8080  и зарегистрируйтесь."
echo "Статус: systemctl status yacal   ·   Логи: journalctl -u yacal -f"
