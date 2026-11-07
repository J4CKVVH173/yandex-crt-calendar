"""Работа с Яндекс Календарём.

У Яндекс Календаря нет REST API — доступ к событиям только по CalDAV (caldav.yandex.ru).
Вход — логин Яндекса + «пароль приложения» типа «Календарь»
(https://id.yandex.ru/security/app-passwords). Основной пароль аккаунта сервер не принимает.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import caldav
import icalendar
import recurring_ical_events

try:
    from caldav.lib import error as cerr
except Exception:  # pragma: no cover
    cerr = caldav.error  # type: ignore[attr-defined]

CALDAV_URL = os.environ.get("YACAL_CALDAV_URL", "https://caldav.yandex.ru")
TIMEOUT = 25


class YandexError(Exception):
    """Ошибка с текстом, который можно показать пользователю."""


AUTH_MSG = (
    "Яндекс не принял логин или пароль приложения. Нужен именно «пароль приложения» "
    "с типом «Календарь» (не основной пароль). Свежесозданный пароль может заработать не сразу."
)


def friendly(e: Exception) -> str:
    if isinstance(e, YandexError):
        return str(e)
    name = type(e).__name__
    text = str(e)
    if isinstance(e, getattr(cerr, "AuthorizationError", ())) or "401" in text or "Unauthorized" in text:
        return AUTH_MSG
    if any(k in name for k in ("Connect", "Timeout", "Network", "Name", "SSL", "Proxy")) or "resolve" in text.lower():
        return "Нет связи с caldav.yandex.ru (проверьте интернет на Raspberry Pi)."
    return f"Ошибка CalDAV: {name}: {text[:200]}"


def _client(email: str, password: str) -> caldav.DAVClient:
    return caldav.DAVClient(url=CALDAV_URL, username=email, password=password, timeout=TIMEOUT)


def _norm_color(value: str | None) -> str | None:
    """'#FF6B6BFF' / '#f66' / 'rgb(...)' → '#rrggbb'."""
    if not value:
        return None
    v = value.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?", v)
    if m:
        return "#" + m.group(1).lower()
    m = re.fullmatch(r"#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])", v)
    if m:
        return "#" + "".join(c * 2 for c in m.groups()).lower()
    return None


def _display_name(cal) -> str:
    try:
        n = cal.get_display_name()
    except Exception:
        n = None
    return (n or "").strip() or "Календарь"


def _calendar_color(cal) -> str | None:
    try:
        from caldav.elements import ical as cical

        return _norm_color(cal.get_property(cical.CalendarColor()))
    except Exception:
        return None


def _list(principal):
    try:
        return principal.get_calendars()
    except AttributeError:  # старые версии библиотеки
        return principal.calendars()


def _discover_at(base_url: str, email: str, password: str) -> list[dict]:
    with caldav.DAVClient(url=base_url, username=email, password=password, timeout=TIMEOUT) as client:
        principal = client.principal()
        out = []
        for cal in _list(principal):
            try:
                comps = cal.get_supported_components()
                if comps and "VEVENT" not in comps:
                    continue  # например, список дел
            except Exception:
                pass
            out.append({"url": str(cal.url), "name": _display_name(cal), "color": _calendar_color(cal)})
        return out


def discover(email: str, password: str) -> list[dict]:
    """Проверяет логин и возвращает календари аккаунта: [{url, name, color}].
    Сначала автообнаружение по корню сервера, затем — по пути из инструкции Яндекса
    (/principals/users/<логин>/)."""
    candidates = [CALDAV_URL, f"{CALDAV_URL.rstrip('/')}/principals/users/{email}/"]
    last: Exception | None = None
    for base in candidates:
        try:
            return _discover_at(base, email, password)
        except Exception as e:
            if friendly(e) == AUTH_MSG:  # неверный пароль — другой путь не поможет
                raise YandexError(AUTH_MSG) from e
            last = e
    raise YandexError(friendly(last)) from last


# ----------------------------------------------------------------- события

def _to_dt(value, tz: ZoneInfo) -> datetime:
    if value.tzinfo is None:  # «плавающее» время — считаем локальным
        return value.replace(tzinfo=tz)
    return value.astimezone(tz)


def _declined(comp, email: str) -> bool:
    att = comp.get("ATTENDEE")
    if att is None:
        return False
    if not isinstance(att, list):
        att = [att]
    me = email.lower()
    for a in att:
        if str(a).lower().endswith(me) and str(a.params.get("PARTSTAT", "")).upper() == "DECLINED":
            return True
    return False


def _events_from_ics(data: str, start: datetime, end: datetime, tz: ZoneInfo, email: str, hide_declined: bool):
    cal = icalendar.Calendar.from_ical(data)
    out = []
    for comp in recurring_ical_events.of(cal, components=["VEVENT"]).between(start, end):
        if str(comp.get("STATUS", "")).upper() == "CANCELLED":
            continue
        if hide_declined and _declined(comp, email):
            continue
        s = comp.start
        e = comp.end
        if s is None:
            continue
        all_day = not isinstance(s, datetime)
        title = str(comp.get("SUMMARY", "") or "").strip() or "(без названия)"
        location = str(comp.get("LOCATION", "") or "").strip()
        private = str(comp.get("CLASS", "")).upper() in ("PRIVATE", "CONFIDENTIAL")
        if all_day:
            if e is None or isinstance(e, datetime) or e <= s:
                e = s + timedelta(days=1)
            item = {"allDay": True, "start": s.isoformat(), "end": e.isoformat()}
        else:
            sd = _to_dt(s, tz)
            ed = _to_dt(e, tz) if e is not None else sd
            if ed < sd:
                ed = sd
            item = {"allDay": False, "start": sd.isoformat(), "end": ed.isoformat()}
        item.update({"title": title, "location": location, "private": private, "uid": str(comp.get("UID", ""))})
        out.append(item)
    return out


def fetch(email: str, password: str, cals: list[tuple[int, str]], start: datetime, end: datetime,
          tz: ZoneInfo, hide_declined: bool = True):
    """Читает события выбранных календарей. Возвращает (events, errors{cal_id: текст})."""
    events: list[dict] = []
    errors: dict[int, str] = {}
    try:
        client_ctx = _client(email, password)
    except Exception as e:
        raise YandexError(friendly(e)) from e
    with client_ctx as client:
        for cal_id, url in cals:
            try:
                cal = client.calendar(url=url)
                objs = cal.search(start=start, end=end, event=True)
                seen = set()
                for obj in objs:
                    for ev in _events_from_ics(obj.data, start, end, tz, email, hide_declined):
                        key = (ev["uid"], ev["start"])
                        if key in seen:
                            continue
                        seen.add(key)
                        ev["cal"] = cal_id
                        ev["id"] = f"{cal_id}:{ev['uid']}:{ev['start']}"
                        events.append(ev)
            except Exception as e:
                errors[cal_id] = friendly(e)
    return events, errors
