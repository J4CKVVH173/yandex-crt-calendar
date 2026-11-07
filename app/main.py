from __future__ import annotations

import asyncio
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import VERSION, db, security, service, yandex

BASE = Path(__file__).resolve().parent.parent
STATIC = BASE / "static"
ALLOW_REGISTRATION = os.environ.get("YACAL_ALLOW_REGISTRATION", "1") != "0"
COOKIE = "sid"
PALETTE = ["#ff9f1a", "#4cd964", "#5ac8fa", "#ff5e7e", "#c792ea", "#ffd60a"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def loop():
        await asyncio.sleep(1)
        while True:
            for uid in service.connected_user_ids():
                try:
                    await asyncio.to_thread(service.refresh_user, uid)
                except Exception:  # фоновая задача не должна падать
                    pass
            await asyncio.sleep(service.REFRESH_SECONDS)

    task = asyncio.create_task(loop())
    yield
    task.cancel()


app = FastAPI(title="Yandex CRT Calendar", version=VERSION, lifespan=lifespan, docs_url=None, redoc_url=None)


# ------------------------------------------------------------- middleware

@app.middleware("http")
async def guard(request: Request, call_next):
    # CSRF: запросы, меняющие состояние, принимаем только с нашего же origin
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and urlparse(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "Недопустимый origin"}, status_code=403)
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/api/") or path == "/manifest.webmanifest":
        response.headers["Cache-Control"] = "no-store"
    elif path.startswith("/static/fonts/"):
        response.headers["Cache-Control"] = "public, max-age=2592000"
    else:
        response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


app.mount("/static", StaticFiles(directory=STATIC), name="static")

_attempts: dict[str, list[float]] = {}


def throttle(request: Request, limit: int = 10, window: int = 600) -> None:
    ip = request.client.host if request.client else "?"
    now = time.time()
    hits = [t for t in _attempts.get(ip, []) if now - t < window]
    if len(hits) >= limit:
        raise HTTPException(429, "Слишком много попыток, подождите несколько минут")
    hits.append(now)
    _attempts[ip] = hits


def current_user(request: Request):
    user = security.session_user(request.cookies.get(COOKIE))
    if not user:
        raise HTTPException(401, "Нужно войти")
    return user


def set_session(response: Response, user_id: int) -> None:
    token = security.create_session(user_id)
    response.set_cookie(COOKIE, token, max_age=security.SESSION_TTL, httponly=True, samesite="lax", path="/")


# ------------------------------------------------------------------ страницы

def page(name: str) -> FileResponse:
    return FileResponse(STATIC / name)


@app.get("/", include_in_schema=False)
def root(request: Request):
    if security.session_user(request.cookies.get(COOKIE)):
        return RedirectResponse("/settings")
    return RedirectResponse("/login")


@app.get("/login", include_in_schema=False)
def login_page():
    return page("login.html")


@app.get("/register", include_in_schema=False)
def register_page():
    return page("register.html")


@app.get("/settings", include_in_schema=False)
def settings_page(request: Request):
    if not security.session_user(request.cookies.get(COOKIE)):
        return RedirectResponse("/login")
    return page("settings.html")


@app.get("/d/{token}", include_in_schema=False)
def display_page(token: str):
    if not db.q1("SELECT 1 FROM users WHERE display_token=?", (token,)):
        raise HTTPException(404, "Экран не найден — проверьте адрес в настройках")
    return page("display.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC / "favicon.ico", media_type="image/x-icon")


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True, "version": VERSION}


@app.get("/app", include_in_schema=False)
def installed_app(request: Request):
    user = security.session_user(request.cookies.get(COOKIE))
    if not user:
        return RedirectResponse("/login?next=app")
    return RedirectResponse(f"/d/{user['display_token']}")


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest(t: str = ""):
    if t and not db.q1("SELECT 1 FROM users WHERE display_token=?", (t,)):
        raise HTTPException(404, "Экран не найден")
    return JSONResponse({
        "id": f"/d/{t}" if t else "/app",
        "name": "Ламповый календарь", "short_name": "Календарь", "lang": "ru",
        "start_url": f"/d/{t}" if t else "/app", "scope": "/",
        "display": "standalone", "background_color": "#0c0800", "theme_color": "#0c0800",
        "icons": [{"src": f"/static/icons/icon-{size}.png", "sizes": f"{size}x{size}",
                   "type": "image/png", "purpose": "any"} for size in (192, 512)],
    }, media_type="application/manifest+json", headers={"Cache-Control": "no-store"})


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript")


# ----------------------------------------------------------------------- auth

class Credentials(BaseModel):
    login: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=1, max_length=200)


@app.get("/api/config")
def config():
    return {"registration": ALLOW_REGISTRATION, "version": VERSION}


@app.post("/api/register")
def register(body: Credentials, request: Request, response: Response):
    throttle(request)
    if not ALLOW_REGISTRATION:
        raise HTTPException(403, "Регистрация отключена")
    login = body.login.strip()
    if not re.fullmatch(r"[\w.@+-]{3,40}", login):
        raise HTTPException(400, "Логин: 3–40 символов — буквы, цифры и . _ @ + -")
    if len(body.password) < 8:
        raise HTTPException(400, "Пароль должен быть не короче 8 символов")
    if db.q1("SELECT 1 FROM users WHERE login=?", (login,)):
        raise HTTPException(409, "Такой логин уже занят")
    uid = db.x(
        "INSERT INTO users(login, pw_hash, display_token, created_at) VALUES(?,?,?,?)",
        (login, security.hash_password(body.password), security.new_token()[:24], int(time.time())),
    )
    db.save_settings(uid, {})
    set_session(response, uid)
    return {"ok": True}


@app.post("/api/login")
def login(body: Credentials, request: Request, response: Response):
    throttle(request)
    user = db.q1("SELECT * FROM users WHERE login=?", (body.login.strip(),))
    if not user or not security.verify_password(body.password, user["pw_hash"]):
        raise HTTPException(401, "Неверный логин или пароль")
    set_session(response, user["id"])
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    security.drop_session(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


# ------------------------------------------------------------------- профиль

def calendars_payload(uid: int) -> list[dict]:
    rows = db.q("SELECT * FROM calendars WHERE user_id=? ORDER BY id", (uid,))
    return [
        {
            "id": r["id"], "name": r["name"], "customName": r["custom_name"], "short": r["short"],
            "color": r["color"], "glyph": r["glyph"], "enabled": bool(r["enabled"]),
            "hideTitles": bool(r["hide_titles"]),
        }
        for r in rows
    ]


@app.get("/api/me")
def me(user=Depends(current_user)):
    uid = user["id"]
    acc = db.q1("SELECT * FROM yandex_accounts WHERE user_id=?", (uid,))
    snap = service.snapshot(uid)
    return {
        "login": user["login"],
        "displayToken": user["display_token"],
        "settings": db.get_settings(uid),
        "yandex": (
            {
                "email": acc["email"],
                "lastOk": acc["last_ok_at"],
                "lastError": (snap or {}).get("error", acc["last_error"]),
            }
            if acc else None
        ),
        "calendars": calendars_payload(uid),
        "eventsCached": len((snap or {}).get("events", [])),
    }


@app.put("/api/settings")
async def put_settings(request: Request, user=Depends(current_user)):
    saved = db.save_settings(user["id"], await request.json())
    return saved


@app.post("/api/token/regenerate")
def regenerate_token(user=Depends(current_user)):
    token = security.new_token()[:24]
    db.x("UPDATE users SET display_token=? WHERE id=?", (token, user["id"]))
    return {"displayToken": token}


# --------------------------------------------------------------------- Яндекс

class YandexConnect(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=200)


def sync_calendars(uid: int, found: list[dict]) -> None:
    with db.tx():
        existing = {r["url"]: r for r in db.q("SELECT * FROM calendars WHERE user_id=?", (uid,))}
        seen = set()
        n = len(existing)
        for f in found:
            seen.add(f["url"])
            if f["url"] in existing:
                db.x("UPDATE calendars SET name=? WHERE id=?", (f["name"], existing[f["url"]]["id"]))
            else:
                db.x(
                    "INSERT INTO calendars(user_id,url,name,color,glyph,enabled) VALUES(?,?,?,?,?,1)",
                    (uid, f["url"], f["name"], f["color"] or PALETTE[n % len(PALETTE)], n % 6),
                )
                n += 1
        for url, row in existing.items():
            if url not in seen:
                db.x("DELETE FROM calendars WHERE id=?", (row["id"],))


@app.post("/api/yandex/connect")
async def yandex_connect(body: YandexConnect, user=Depends(current_user)):
    uid = user["id"]
    email = body.email.strip()
    password = body.password.strip().replace(" ", "")
    try:
        found = await asyncio.to_thread(yandex.discover, email, password)
    except yandex.YandexError as e:
        raise HTTPException(400, str(e))
    db.x(
        "INSERT INTO yandex_accounts(user_id,email,enc_password,connected_at) VALUES(?,?,?,?) "
        "ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, enc_password=excluded.enc_password, "
        "connected_at=excluded.connected_at, last_error=NULL",
        (uid, email, security.encrypt(password), int(time.time())),
    )
    sync_calendars(uid, found)
    service.forget(uid)
    asyncio.create_task(asyncio.to_thread(service.refresh_user, uid))
    return {"calendars": calendars_payload(uid)}


@app.post("/api/yandex/rediscover")
async def yandex_rediscover(user=Depends(current_user)):
    uid = user["id"]
    acc = db.q1("SELECT * FROM yandex_accounts WHERE user_id=?", (uid,))
    if not acc:
        raise HTTPException(400, "Яндекс не подключён")
    try:
        found = await asyncio.to_thread(yandex.discover, acc["email"], security.decrypt(acc["enc_password"]))
    except (yandex.YandexError, ValueError) as e:
        raise HTTPException(400, str(e))
    sync_calendars(uid, found)
    return {"calendars": calendars_payload(uid)}


@app.delete("/api/yandex")
def yandex_disconnect(user=Depends(current_user)):
    uid = user["id"]
    db.x("DELETE FROM yandex_accounts WHERE user_id=?", (uid,))
    db.x("DELETE FROM calendars WHERE user_id=?", (uid,))
    service.forget(uid)
    return {"ok": True}


@app.post("/api/refresh")
async def refresh(user=Depends(current_user)):
    snap = await asyncio.to_thread(service.refresh_user, user["id"])
    return {"error": (snap or {}).get("error"), "events": len((snap or {}).get("events", []))}


class CalendarPatch(BaseModel):
    enabled: bool | None = None
    customName: str | None = Field(default=None, max_length=40)
    short: str | None = Field(default=None, max_length=8)
    color: str | None = None
    glyph: int | None = Field(default=None, ge=0, le=5)
    hideTitles: bool | None = None


@app.put("/api/calendars/{cal_id}")
async def patch_calendar(cal_id: int, body: CalendarPatch, user=Depends(current_user)):
    uid = user["id"]
    row = db.q1("SELECT * FROM calendars WHERE id=? AND user_id=?", (cal_id, uid))
    if not row:
        raise HTTPException(404, "Календарь не найден")
    sets, args = [], []
    if body.enabled is not None:
        sets.append("enabled=?"); args.append(int(body.enabled))
    if body.customName is not None:
        sets.append("custom_name=?"); args.append(body.customName.strip())
    if body.short is not None:
        sets.append("short=?"); args.append(body.short.strip())
    if body.color is not None:
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", body.color):
            raise HTTPException(400, "Цвет должен быть вида #rrggbb")
        sets.append("color=?"); args.append(body.color.lower())
    if body.glyph is not None:
        sets.append("glyph=?"); args.append(body.glyph)
    if body.hideTitles is not None:
        sets.append("hide_titles=?"); args.append(int(body.hideTitles))
    if sets:
        db.x(f"UPDATE calendars SET {', '.join(sets)} WHERE id=?", (*args, cal_id))
    if body.enabled is not None and body.enabled != bool(row["enabled"]):
        asyncio.create_task(asyncio.to_thread(service.refresh_user, uid))
    return {"calendars": calendars_payload(uid)}


# ------------------------------------------------------------------- экран

@app.get("/api/display")
async def display(t: str = ""):
    user = db.q1("SELECT * FROM users WHERE display_token=?", (t,))
    if not user:
        raise HTTPException(404, "Экран не найден")
    uid = user["id"]
    acc = db.q1("SELECT 1 FROM yandex_accounts WHERE user_id=?", (uid,))
    snap = service.snapshot(uid)
    if acc and snap is None:
        snap = await asyncio.to_thread(service.refresh_user, uid)
    snap = snap or {"events": [], "ok_at": None, "error": None, "fetched_at": None}

    settings = db.get_settings(uid)
    cals = [c for c in calendars_payload(uid) if c["enabled"]]
    by_id = {c["id"]: c for c in cals}
    events = []
    for e in snap.get("events", []):
        c = by_id.get(e["cal"])
        if not c:
            continue
        ev = {k: e[k] for k in ("id", "cal", "title", "location", "start", "end", "allDay")}
        if c["hideTitles"] or (settings["maskPrivate"] and e.get("private")):
            ev["title"], ev["location"] = "Занято", ""
        events.append(ev)

    return {
        "version": VERSION,
        "now": int(time.time() * 1000),
        "settings": settings,
        "calendars": [
            {"id": c["id"], "name": c["customName"] or c["name"], "short": c["short"], "color": c["color"],
             "glyph": c["glyph"]}
            for c in cals
        ],
        "events": events,
        "status": {
            "connected": bool(acc),
            "okAt": int(snap["ok_at"] * 1000) if snap.get("ok_at") else None,
            "error": snap.get("error"),
        },
    }
