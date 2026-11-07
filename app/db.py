"""SQLite-хранилище: пользователи, сессии, подключение к Яндексу, календари, настройки экрана."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from zoneinfo import ZoneInfo

DATA_DIR = Path(os.environ.get("YACAL_DATA", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

_lock = threading.RLock()
_conn = sqlite3.connect(DATA_DIR / "yacal.db", check_same_thread=False, isolation_level=None)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL")
_conn.execute("PRAGMA foreign_keys=ON")

_conn.executescript(
    """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash TEXT NOT NULL,
    display_token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS yandex_accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    enc_password TEXT NOT NULL,
    connected_at INTEGER NOT NULL,
    last_ok_at INTEGER,
    last_error TEXT
);
CREATE TABLE IF NOT EXISTS calendars (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    name TEXT NOT NULL,
    custom_name TEXT NOT NULL DEFAULT '',
    short TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    glyph INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    hide_titles INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, url)
);
"""
)


def q(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        return _conn.execute(sql, args).fetchall()


def q1(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    with _lock:
        return _conn.execute(sql, args).fetchone()


def x(sql: str, args: tuple = ()) -> int:
    with _lock:
        return _conn.execute(sql, args).lastrowid


@contextmanager
def tx():
    with _lock:
        _conn.execute("BEGIN")
        try:
            yield _conn
        except BaseException:
            _conn.execute("ROLLBACK")
            raise
        else:
            _conn.execute("COMMIT")


# ---------------------------------------------------------------- настройки экрана

DEFAULT_SETTINGS = {
    "timezone": "Europe/Moscow",
    "theme": "amber",        # amber | green | white | color | autumn | halloween | newyear | winter | season (авто)
    "decor": True,           # праздничные украшения (листья, снег, гирлянда…)
    "fx": 2,                 # 0..3 — сила ЭЛТ-эффектов
    "layout": "auto",        # auto | wide | stack
    "fontScale": 1.0,        # 0.7..1.6
    "safe": 3,               # отступ от краёв (оверскан ЭЛТ), %
    "days": 3,               # сколько дней показывать (1..7)
    "showSeconds": True,
    "burnIn": True,          # лёгкое «плавание» картинки против выгорания
    "warnMinutes": 15,       # за сколько минут до встречи начинать подсвечивать
    "nightEnabled": True,
    "nightFrom": 23,
    "nightTo": 7,
    "nightLevel": 0.5,       # яркость ночью
    "hideDeclined": True,    # скрывать события, от которых вы отказались
    "maskPrivate": False,    # закрытые события (CLASS:PRIVATE) показывать как «Занято»
}


def _clamp(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def sanitize_settings(raw: dict | None) -> dict:
    raw = raw or {}
    s = dict(DEFAULT_SETTINGS)
    tzname = str(raw.get("timezone", s["timezone"]))
    try:
        ZoneInfo(tzname)
        s["timezone"] = tzname
    except Exception:
        pass
    if raw.get("theme") in ("amber", "green", "white", "color", "autumn", "halloween", "newyear", "winter", "season"):
        s["theme"] = raw["theme"]
    if raw.get("layout") in ("auto", "wide", "stack"):
        s["layout"] = raw["layout"]
    s["fx"] = int(_clamp(raw.get("fx", s["fx"]), 0, 3, s["fx"]))
    s["fontScale"] = round(_clamp(raw.get("fontScale", s["fontScale"]), 0.7, 1.6, s["fontScale"]), 2)
    s["safe"] = int(_clamp(raw.get("safe", s["safe"]), 0, 8, s["safe"]))
    s["days"] = int(_clamp(raw.get("days", s["days"]), 1, 7, s["days"]))
    s["warnMinutes"] = int(_clamp(raw.get("warnMinutes", s["warnMinutes"]), 5, 60, s["warnMinutes"]))
    s["nightFrom"] = int(_clamp(raw.get("nightFrom", s["nightFrom"]), 0, 23, s["nightFrom"]))
    s["nightTo"] = int(_clamp(raw.get("nightTo", s["nightTo"]), 0, 23, s["nightTo"]))
    s["nightLevel"] = round(_clamp(raw.get("nightLevel", s["nightLevel"]), 0.15, 1, s["nightLevel"]), 2)
    for k in ("showSeconds", "burnIn", "nightEnabled", "hideDeclined", "decor", "maskPrivate"):
        s[k] = bool(raw.get(k, s[k]))
    return s


def get_settings(user_id: int) -> dict:
    row = q1("SELECT json FROM user_settings WHERE user_id=?", (user_id,))
    try:
        raw = json.loads(row["json"]) if row else {}
    except ValueError:
        raw = {}
    return sanitize_settings(raw)


def save_settings(user_id: int, raw: dict) -> dict:
    s = sanitize_settings(raw)
    x(
        "INSERT INTO user_settings(user_id, json) VALUES(?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET json=excluded.json",
        (user_id, json.dumps(s, ensure_ascii=False)),
    )
    return s
