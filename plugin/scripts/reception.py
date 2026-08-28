#!/usr/bin/env python3
"""The local, owner-level reception for remote messages.

The managed client decrypts into a private SQLite quarantine shared by every
city on this computer.  The Hall may display that text as inert HTML-escaped
content and make one atomic decision: reject it with a reason, or route it to
one or more local cities.  City buses consume only the resulting route rows;
they never query pending messages.

SQLite is intentional here: several city processes and the threaded Hall can
touch the same reception. WAL plus ``BEGIN IMMEDIATE`` gives a serial decision
boundary without a server, account database, or public port on this computer.
"""

import datetime
import os
import re
import sqlite3

import cities


PROTOCOL = "agents-city-reception/1"
SCHEMA_VERSION = 1
MESSAGE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,180}$")
MAX_DESTINATIONS = 32


SCHEMA = f"""
CREATE TABLE IF NOT EXISTS reception_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reception_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  routing_mode TEXT NOT NULL DEFAULT 'manual' CHECK (routing_mode IN ('manual', 'auto')),
  review_policy TEXT NOT NULL DEFAULT 'every_message' CHECK (
    review_policy IN ('every_message', 'new_thread')
  ),
  router_profile TEXT CHECK (router_profile IS NULL OR length(router_profile) <= 160),
  updated_at TEXT NOT NULL,
  CHECK (routing_mode = 'manual' OR router_profile IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS reception_messages (
  message_id TEXT PRIMARY KEY CHECK (length(message_id) BETWEEN 1 AND 180),
  protocol TEXT NOT NULL CHECK (protocol = '{PROTOCOL}'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'routed', 'rejected', 'expired')),
  source_city TEXT NOT NULL CHECK (length(source_city) BETWEEN 3 AND 160),
  source_created_at TEXT NOT NULL,
  received_city_id TEXT NOT NULL CHECK (length(received_city_id) BETWEEN 1 AND 160),
  received_city_address TEXT NOT NULL CHECK (length(received_city_address) BETWEEN 3 AND 160),
  body TEXT,
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  connection_id TEXT,
  road_id TEXT,
  remote_message_id TEXT,
  received_at TEXT NOT NULL,
  decided_at TEXT,
  decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  CHECK (state = 'pending' OR decided_at IS NOT NULL),
  CHECK (state <> 'pending' OR body IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_reception_messages_state_age
  ON reception_messages (state, received_at, message_id);
CREATE TABLE IF NOT EXISTS reception_routes (
  message_id TEXT NOT NULL REFERENCES reception_messages(message_id) ON DELETE CASCADE,
  target_city_id TEXT NOT NULL CHECK (length(target_city_id) BETWEEN 1 AND 160),
  target_city_address TEXT NOT NULL CHECK (length(target_city_address) BETWEEN 3 AND 160),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'delivered', 'failed')),
  approved_by TEXT NOT NULL CHECK (approved_by IN ('human', 'auto')),
  approved_at TEXT NOT NULL,
  delivered_at TEXT,
  error TEXT CHECK (error IS NULL OR length(error) <= 300),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at INTEGER,
  next_attempt_at INTEGER,
  PRIMARY KEY (message_id, target_city_id)
);
CREATE INDEX IF NOT EXISTS idx_reception_routes_city_state
  ON reception_routes (target_city_id, state, approved_at);
CREATE TABLE IF NOT EXISTS reception_counters (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  pending_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  pending_bytes INTEGER NOT NULL DEFAULT 0 CHECK (pending_bytes >= 0)
);
CREATE TRIGGER IF NOT EXISTS reception_message_count_after_insert
AFTER INSERT ON reception_messages WHEN NEW.state = 'pending'
BEGIN
  UPDATE reception_counters
  SET pending_count = pending_count + 1,
      pending_bytes = pending_bytes + length(CAST(NEW.body AS BLOB))
  WHERE singleton = 1;
END;
CREATE TRIGGER IF NOT EXISTS reception_message_count_after_decision
AFTER UPDATE OF state ON reception_messages
WHEN OLD.state = 'pending' AND NEW.state <> 'pending'
BEGIN
  UPDATE reception_counters
  SET pending_count = MAX(0, pending_count - 1),
      pending_bytes = MAX(0, pending_bytes - length(CAST(OLD.body AS BLOB)))
  WHERE singleton = 1;
END;
CREATE TRIGGER IF NOT EXISTS reception_message_count_after_delete
AFTER DELETE ON reception_messages WHEN OLD.state = 'pending'
BEGIN
  UPDATE reception_counters
  SET pending_count = MAX(0, pending_count - 1),
      pending_bytes = MAX(0, pending_bytes - length(CAST(OLD.body AS BLOB)))
  WHERE singleton = 1;
END;
"""


class ReceptionError(ValueError):
    """A safe, user-facing refusal from the reception boundary."""


def _ahora():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _directorio():
    base = os.path.realpath(cities.raiz())
    runtime = os.path.join(base, ".runtime")
    recepcion = os.path.join(runtime, "reception")
    for ruta in (runtime, recepcion):
        if not os.path.exists(ruta):
            os.mkdir(ruta, mode=0o700)
        if not os.path.isdir(ruta) or os.path.islink(ruta):
            raise ReceptionError(f"unsafe reception directory: {ruta}")
        os.chmod(ruta, 0o700)
    return recepcion


def ruta_base():
    return os.path.join(_directorio(), "reception.sqlite3")


def _conecta():
    ruta = ruta_base()
    if os.path.lexists(ruta):
        if not os.path.isfile(ruta) or os.path.islink(ruta):
            raise ReceptionError("unsafe reception database")
    db = sqlite3.connect(ruta, timeout=5, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        os.chmod(ruta, 0o600)
        db.execute("PRAGMA journal_mode = WAL")
        db.execute("PRAGMA synchronous = FULL")
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA busy_timeout = 5000")
        db.executescript(SCHEMA)
        meta = db.execute(
            "SELECT schema_version FROM reception_meta WHERE singleton = 1"
        ).fetchone()
        if meta and meta["schema_version"] != SCHEMA_VERSION:
            raise ReceptionError(
                f"unsupported reception schema: {meta['schema_version']}"
            )
        ahora = _ahora()
        db.execute(
            "INSERT OR IGNORE INTO reception_meta VALUES (1, ?, ?)",
            (SCHEMA_VERSION, ahora),
        )
        db.execute(
            """INSERT OR IGNORE INTO reception_settings
               (singleton, routing_mode, review_policy, router_profile, updated_at)
               VALUES (1, 'manual', 'every_message', NULL, ?)""",
            (ahora,),
        )
        db.execute(
            "INSERT OR IGNORE INTO reception_counters VALUES (1, 0, 0)"
        )
        return db
    except Exception:
        db.close()
        raise


def _ciudades(usuario, actual=""):
    candidatas = list(cities.lista(usuario))
    if actual:
        real = os.path.realpath(actual)
        if not any(os.path.realpath(c["ruta"]) == real for c in candidatas):
            owner = cities.lee_clave(real, "owner") or usuario
            if cities.es_ciudad(real) and owner == usuario:
                candidatas.append(
                    {
                        "ruta": real,
                        "nombre": cities.nombre(real),
                        "slug": cities.slug_ciudad(real),
                        "id": cities.identidad(real),
                        "owner": owner,
                    }
                )
    fuera = []
    for ciudad in candidatas:
        ident = str(ciudad.get("id") or "")
        slug = str(ciudad.get("slug") or cities.slug_ciudad(ciudad["ruta"]))
        owner = str(ciudad.get("owner") or usuario)
        if not ident or not slug:
            continue
        fuera.append(
            {
                "id": ident,
                "name": str(ciudad.get("nombre") or slug),
                "address": f"{owner}/{slug}",
                "path": ciudad["ruta"],
            }
        )
    return fuera


def estado(usuario, limite=200, actual=""):
    """Return only pending inert text plus local destinations and counters."""
    limite = max(1, min(int(limite), 200))
    db = _conecta()
    try:
        ajustes = db.execute(
            """SELECT routing_mode, review_policy, router_profile, updated_at
               FROM reception_settings WHERE singleton = 1"""
        ).fetchone()
        contadores = db.execute(
            "SELECT pending_count, pending_bytes FROM reception_counters WHERE singleton = 1"
        ).fetchone()
        mensajes = db.execute(
            """SELECT message_id, source_city, source_created_at,
                      received_city_id, received_city_address, body,
                      connection_id, road_id, received_at
               FROM reception_messages
               WHERE state = 'pending'
               ORDER BY received_at, message_id LIMIT ?""",
            (limite,),
        ).fetchall()
        ciudades = _ciudades(usuario, actual)
        return {
            "protocol": PROTOCOL,
            "settings": {
                "routingMode": ajustes["routing_mode"],
                "reviewPolicy": ajustes["review_policy"],
                "routerProfile": ajustes["router_profile"],
                # Auto-routing needs a separately isolated, schema-only router.
                # No general city agent is silently promoted into that trust role.
                "autoAvailable": False,
            },
            "summary": {
                "pending": int(contadores["pending_count"]),
                "pendingBytes": int(contadores["pending_bytes"]),
                "shown": len(mensajes),
            },
            "messages": [
                {
                    "id": fila["message_id"],
                    "from": fila["source_city"],
                    "createdAt": fila["source_created_at"],
                    "receivedAt": fila["received_at"],
                    "receivedVia": fila["received_city_address"],
                    "text": fila["body"],
                    "connectionId": fila["connection_id"],
                    "roadId": fila["road_id"],
                    "agentExposure": False,
                }
                for fila in mensajes
            ],
            "cities": [
                {"id": c["id"], "name": c["name"], "address": c["address"]}
                for c in ciudades
            ],
        }
    finally:
        db.close()


def resumen():
    """The cheap counter used by the persistent Hall rail."""
    db = _conecta()
    try:
        ajustes = db.execute(
            """SELECT routing_mode, review_policy, router_profile
               FROM reception_settings WHERE singleton = 1"""
        ).fetchone()
        contadores = db.execute(
            "SELECT pending_count, pending_bytes FROM reception_counters WHERE singleton = 1"
        ).fetchone()
        return {
            "pending": int(contadores["pending_count"]),
            "pendingBytes": int(contadores["pending_bytes"]),
            "routingMode": ajustes["routing_mode"],
            "reviewPolicy": ajustes["review_policy"],
            "routerProfile": ajustes["router_profile"],
            "autoAvailable": False,
        }
    finally:
        db.close()


def _prepara_decision(usuario, message_id, accion, destinos, motivo, actual):
    """Validate all human input before opening the serial decision transaction."""
    message_id = str(message_id or "")
    accion = str(accion or "")
    motivo = " ".join(str(motivo or "").split())[:500]
    if not MESSAGE_ID.fullmatch(message_id):
        raise ReceptionError("invalid reception message id")
    if accion not in ("route", "reject"):
        raise ReceptionError("action must be route or reject")
    if accion == "reject" and not motivo:
        raise ReceptionError("write a reason before rejecting the message")
    ciudades = {c["id"]: c for c in _ciudades(usuario, actual)}
    elegidas = list(dict.fromkeys(str(x) for x in (destinos or []) if str(x)))
    if accion == "route":
        if not elegidas or len(elegidas) > MAX_DESTINATIONS:
            raise ReceptionError("choose between 1 and 32 destination cities")
        desconocidas = [ident for ident in elegidas if ident not in ciudades]
        if desconocidas:
            raise ReceptionError("a destination is not one of your local cities")
    return message_id, accion, motivo, ciudades, elegidas


def decide(usuario, message_id, accion, destinos=None, motivo="", actual=""):
    """Atomically reject one message or queue it for one or more owned cities."""
    message_id, accion, motivo, ciudades, elegidas = _prepara_decision(
        usuario, message_id, accion, destinos, motivo, actual
    )
    ahora = _ahora()
    db = _conecta()
    comprometida = False
    try:
        db.execute("BEGIN IMMEDIATE")
        mensaje = db.execute(
            "SELECT state FROM reception_messages WHERE message_id = ?", (message_id,)
        ).fetchone()
        if not mensaje:
            raise ReceptionError("reception message not found")
        if mensaje["state"] != "pending":
            raise ReceptionError("that reception message has already been decided")
        if accion == "reject":
            db.execute(
                """UPDATE reception_messages
                   SET state = 'rejected', body = NULL, decided_at = ?, decision_reason = ?
                   WHERE message_id = ? AND state = 'pending'""",
                (ahora, motivo, message_id),
            )
        else:
            for ident in elegidas:
                ciudad = ciudades[ident]
                db.execute(
                    """INSERT INTO reception_routes
                       (message_id, target_city_id, target_city_address, state,
                        approved_by, approved_at)
                       VALUES (?, ?, ?, 'queued', 'human', ?)""",
                    (message_id, ident, ciudad["address"], ahora),
                )
            db.execute(
                """UPDATE reception_messages
                   SET state = 'routed', decided_at = ?, decision_reason = NULL
                   WHERE message_id = ? AND state = 'pending'""",
                (ahora, message_id),
            )
        if db.execute("SELECT changes()").fetchone()[0] != 1:
            raise ReceptionError("reception decision conflict")
        db.execute("COMMIT")
        comprometida = True
        return {
            "ok": True,
            "id": message_id,
            "status": "rejected" if accion == "reject" else "routed",
            "destinations": elegidas if accion == "route" else [],
            "reason": motivo if accion == "reject" else None,
        }
    except sqlite3.IntegrityError as error:
        raise ReceptionError("reception decision conflict") from error
    finally:
        if not comprometida:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
        db.close()
