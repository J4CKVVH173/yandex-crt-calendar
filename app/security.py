"""Пароли (scrypt), шифрование пароля приложения Яндекса (Fernet), сессии."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time

from cryptography.fernet import Fernet, InvalidToken

from . import db

SESSION_TTL = 30 * 24 * 3600


# ------------------------------------------------------------------ пароли

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, h_hex = stored.split("$")
        h = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(h.hex(), h_hex)
    except Exception:
        return False


# ------------------------------------------------------- шифрование секретов

def _load_fernet() -> Fernet:
    path = db.DATA_DIR / "secret.key"
    if not path.exists():
        path.write_bytes(Fernet.generate_key())
        os.chmod(path, 0o600)
    return Fernet(path.read_bytes())


_fernet = _load_fernet()


def encrypt(text: str) -> str:
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken as e:  # потеряли secret.key
        raise ValueError("Не удаётся расшифровать пароль приложения — подключите Яндекс заново") from e


# ------------------------------------------------------------------- сессии

def new_token() -> str:
    return secrets.token_urlsafe(32)


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: int) -> str:
    token = new_token()
    now = int(time.time())
    db.x("DELETE FROM sessions WHERE expires_at < ?", (now,))
    db.x(
        "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)",
        (_h(token), user_id, now + SESSION_TTL),
    )
    return token


def session_user(token: str | None):
    if not token:
        return None
    return db.q1(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = ? AND s.expires_at > ?",
        (_h(token), int(time.time())),
    )


def drop_session(token: str | None) -> None:
    if token:
        db.x("DELETE FROM sessions WHERE token_hash = ?", (_h(token),))
