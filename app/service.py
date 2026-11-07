"""Кэш событий и фоновое обновление. Монитор опрашивает наш сервер, а не Яндекс —
так календарь не дёргается лишний раз, а экран продолжает работать при кратковременной потере связи."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import db, security, yandex

REFRESH_SECONDS = 180

_cache: dict[int, dict] = {}
_locks: dict[int, threading.Lock] = {}
_guard = threading.Lock()


def _lock_for(uid: int) -> threading.Lock:
    with _guard:
        return _locks.setdefault(uid, threading.Lock())


def snapshot(uid: int) -> dict | None:
    return _cache.get(uid)


def forget(uid: int) -> None:
    _cache.pop(uid, None)


def connected_user_ids() -> list[int]:
    return [r["user_id"] for r in db.q("SELECT user_id FROM yandex_accounts")]


def window(settings: dict) -> tuple[datetime, datetime, ZoneInfo]:
    tz = ZoneInfo(settings["timezone"])
    today = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    return today - timedelta(days=1), today + timedelta(days=settings["days"] + 1), tz


def refresh_user(uid: int) -> dict:
    """Синхронная (блокирующая) загрузка — вызывать через to_thread."""
    lock = _lock_for(uid)
    if not lock.acquire(blocking=False):  # уже идёт обновление
        return _cache.get(uid) or {}
    try:
        acc = db.q1("SELECT * FROM yandex_accounts WHERE user_id=?", (uid,))
        snap = _cache.get(uid) or {"events": [], "ok_at": None}
        if not acc:
            snap = {"events": [], "ok_at": None, "error": "Яндекс не подключён", "fetched_at": time.time()}
            _cache[uid] = snap
            return snap
        cals = db.q("SELECT id, url FROM calendars WHERE user_id=? AND enabled=1", (uid,))
        settings = db.get_settings(uid)
        start, end, tz = window(settings)
        error = None
        try:
            password = security.decrypt(acc["enc_password"])
            if not cals:
                events, errors = [], {}
            else:
                events, errors = yandex.fetch(
                    acc["email"], password, [(c["id"], c["url"]) for c in cals],
                    start, end, tz, settings["hideDeclined"],
                )
            if errors and len(errors) == len(cals):
                error = next(iter(errors.values()))
            else:
                if errors:
                    error = "Часть календарей не прочиталась: " + next(iter(errors.values()))
                snap = {"events": sorted(events, key=lambda e: (e["start"], e["title"])), "ok_at": time.time()}
        except Exception as e:  # не затираем прошлые события — экран продолжит показывать последние данные
            error = yandex.friendly(e) if not isinstance(e, ValueError) else str(e)
        snap = dict(snap)
        snap["error"] = error
        snap["fetched_at"] = time.time()
        _cache[uid] = snap
        db.x(
            "UPDATE yandex_accounts SET last_ok_at=?, last_error=? WHERE user_id=?",
            (int(snap["ok_at"]) if snap.get("ok_at") else None, error, uid),
        )
        return snap
    finally:
        lock.release()
