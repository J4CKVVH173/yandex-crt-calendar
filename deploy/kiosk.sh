#!/usr/bin/env bash
# Открывает экран календаря в Chromium на весь экран.
#   ./kiosk.sh "http://localhost:8080/d/ВАШ_КЛЮЧ"
# Адрес берётся со страницы настроек («Адрес для монитора»).
URL="${1:-$(cat "$HOME/.yacal-url" 2>/dev/null)}"
[[ -n "$URL" ]] || { echo "Укажите адрес экрана (или положите его в ~/.yacal-url)"; exit 1; }
# дождаться, пока поднимется сервер
for _ in $(seq 1 60); do curl -fs "http://localhost:8080/healthz" >/dev/null && break; sleep 1; done
BROWSER="$(command -v chromium-browser || command -v chromium)"
exec "$BROWSER" --kiosk --incognito --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 --overscroll-history-navigation=0 "$URL"
