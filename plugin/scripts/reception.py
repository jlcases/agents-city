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
import json
import os
import re
import sqlite3
import unicodedata
import uuid

import cities


PROTOCOL = "agents-city-reception/1"
SCHEMA_VERSION = 3
AUTO_ROUTER_PROFILE = "deterministic-rules/1"
MESSAGE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,180}$")
CONNECTION_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
MAX_DESTINATIONS = 32
MAX_OUTBOX_BYTES = 11_500


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
  source_name TEXT CHECK (source_name IS NULL OR length(source_name) <= 100),
  message_kind TEXT NOT NULL DEFAULT 'message' CHECK (
    message_kind IN ('message', 'rejection')
  ),
  in_reply_to TEXT CHECK (in_reply_to IS NULL OR length(in_reply_to) <= 180),
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
CREATE TABLE IF NOT EXISTS reception_connections (
  road_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL UNIQUE,
  peer_name TEXT NOT NULL CHECK (length(peer_name) BETWEEN 1 AND 100),
  peer_endpoint TEXT NOT NULL CHECK (length(peer_endpoint) BETWEEN 3 AND 160),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reception_outbox (
  message_id TEXT PRIMARY KEY CHECK (length(message_id) = 36),
  road_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'rejection')),
  body TEXT,
  in_reply_to TEXT CHECK (in_reply_to IS NULL OR length(in_reply_to) <= 180),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent')),
  created_at TEXT NOT NULL,
  sent_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at INTEGER,
  next_attempt_at INTEGER,
  error TEXT CHECK (error IS NULL OR length(error) <= 300)
);
CREATE INDEX IF NOT EXISTS idx_reception_outbox_state_age
  ON reception_outbox (state, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS reception_auto_rules (
  rule_id TEXT PRIMARY KEY CHECK (length(rule_id) = 36),
  target_city_id TEXT NOT NULL UNIQUE CHECK (length(target_city_id) BETWEEN 1 AND 160),
  target_city_address TEXT NOT NULL CHECK (length(target_city_address) BETWEEN 3 AND 160),
  keywords_json TEXT NOT NULL CHECK (length(keywords_json) BETWEEN 5 AND 2000),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
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
        if meta and meta["schema_version"] == 1:
            db.execute("BEGIN IMMEDIATE")
            try:
                actual = db.execute(
                    "SELECT schema_version FROM reception_meta WHERE singleton = 1"
                ).fetchone()
                if actual and actual["schema_version"] == 1:
                    db.execute(
                        """ALTER TABLE reception_messages ADD COLUMN source_name TEXT
                           CHECK (source_name IS NULL OR length(source_name) <= 100)"""
                    )
                    db.execute(
                        """ALTER TABLE reception_messages ADD COLUMN message_kind TEXT
                           NOT NULL DEFAULT 'message'
                           CHECK (message_kind IN ('message', 'rejection'))"""
                    )
                    db.execute(
                        """ALTER TABLE reception_messages ADD COLUMN in_reply_to TEXT
                           CHECK (in_reply_to IS NULL OR length(in_reply_to) <= 180)"""
                    )
                    db.execute(
                        "UPDATE reception_meta SET schema_version = ? WHERE singleton = 1",
                        (SCHEMA_VERSION,),
                    )
                elif actual and actual["schema_version"] == 2:
                    db.execute(
                        "UPDATE reception_meta SET schema_version = ? WHERE singleton = 1",
                        (SCHEMA_VERSION,),
                    )
                elif not actual or actual["schema_version"] != SCHEMA_VERSION:
                    raise ReceptionError("unsupported reception schema")
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
        elif meta and meta["schema_version"] != SCHEMA_VERSION:
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
            """SELECT message_id, source_city, source_name, source_created_at,
                      message_kind, in_reply_to,
                      received_city_id, received_city_address, body,
                      connection_id, road_id, received_at
               FROM reception_messages
               WHERE state = 'pending'
               ORDER BY received_at, message_id LIMIT ?""",
            (limite,),
        ).fetchall()
        conexiones = db.execute(
            """SELECT connection_id, road_id, peer_name, peer_endpoint
               FROM reception_connections WHERE status = 'active'
               ORDER BY peer_name COLLATE NOCASE, connection_id"""
        ).fetchall()
        salientes = db.execute(
            "SELECT COUNT(*) AS queued FROM reception_outbox WHERE state = 'queued'"
        ).fetchone()
        reglas = db.execute(
            """SELECT target_city_id, target_city_address, keywords_json, priority
               FROM reception_auto_rules WHERE enabled = 1
               ORDER BY priority DESC, rule_id"""
        ).fetchall()
        ciudades = _ciudades(usuario, actual)
        return {
            "protocol": PROTOCOL,
            "settings": {
                "routingMode": ajustes["routing_mode"],
                "reviewPolicy": ajustes["review_policy"],
                "routerProfile": ajustes["router_profile"],
                "autoAvailable": bool(reglas),
                "autoRules": [
                    {
                        "cityId": fila["target_city_id"],
                        "address": fila["target_city_address"],
                        "keywords": json.loads(fila["keywords_json"]),
                    }
                    for fila in reglas
                ],
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
                    "fromName": fila["source_name"] or fila["source_city"],
                    "kind": fila["message_kind"],
                    "inReplyTo": fila["in_reply_to"],
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
            "connections": [
                {
                    "id": fila["connection_id"],
                    "roadId": fila["road_id"],
                    "name": fila["peer_name"],
                    # An endpoint is technical transport metadata. The Hall does
                    # not show it or present it as a city to the sender.
                    "connected": True,
                }
                for fila in conexiones
            ],
            "outbox": {"queued": int(salientes["queued"])},
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
        reglas = db.execute(
            "SELECT COUNT(*) AS count FROM reception_auto_rules WHERE enabled = 1"
        ).fetchone()
        return {
            "pending": int(contadores["pending_count"]),
            "pendingBytes": int(contadores["pending_bytes"]),
            "routingMode": ajustes["routing_mode"],
            "reviewPolicy": ajustes["review_policy"],
            "routerProfile": ajustes["router_profile"],
            "autoAvailable": int(reglas["count"]) > 0,
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


def _valida_salida(connection_id, texto):
    connection_id = str(connection_id or "")
    texto = str(texto or "")
    if not CONNECTION_ID.fullmatch(connection_id):
        raise ReceptionError("invalid connection")
    if not texto.strip():
        raise ReceptionError("write a message before sending")
    if len(texto.encode("utf-8")) > MAX_OUTBOX_BYTES:
        raise ReceptionError("message is too large")
    return connection_id, texto


def _normaliza_keyword(value):
    return " ".join(
        unicodedata.normalize("NFKC", str(value or "")).lower().split()
    )


def _prepara_reglas_auto(ciudades, rules):
    preparadas = []
    vistas = set()
    for raw in rules:
        if not isinstance(raw, dict):
            raise ReceptionError("invalid automatic rule")
        ident = str(raw.get("city_id") or "")
        if ident not in ciudades or ident in vistas:
            raise ReceptionError("an automatic destination is not one of your local cities")
        keywords = raw.get("keywords")
        if isinstance(keywords, str):
            keywords = re.split(r"[,\n]", keywords)
        if not isinstance(keywords, list):
            raise ReceptionError("automatic keywords must be a list")
        normalizadas = list(dict.fromkeys(
            keyword for keyword in (_normaliza_keyword(x) for x in keywords) if keyword
        ))
        if not normalizadas:
            continue
        if len(normalizadas) > 20 or any(len(x) > 80 for x in normalizadas):
            raise ReceptionError("use at most 20 short keywords per city")
        vistas.add(ident)
        preparadas.append((
            str(uuid.uuid4()),
            ident,
            ciudades[ident]["address"],
            json.dumps(normalizadas, ensure_ascii=False, separators=(",", ":")),
            0,
        ))
    return preparadas


def configura(usuario, routing_mode, rules, actual=""):
    """Replace the closed Auto allowlist and switch modes atomically."""
    routing_mode = str(routing_mode or "")
    if routing_mode not in ("manual", "auto"):
        raise ReceptionError("routing mode must be manual or auto")
    if not isinstance(rules, list) or len(rules) > MAX_DESTINATIONS:
        raise ReceptionError("automatic rules must be a list of at most 32 cities")
    ciudades = {c["id"]: c for c in _ciudades(usuario, actual)}
    preparadas = _prepara_reglas_auto(ciudades, rules)
    if routing_mode == "auto" and not preparadas:
        raise ReceptionError("add at least one city rule before enabling Auto")
    ahora = _ahora()
    db = _conecta()
    comprometida = False
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM reception_auto_rules")
        db.executemany(
            """INSERT INTO reception_auto_rules (
                 rule_id, target_city_id, target_city_address, keywords_json,
                 priority, enabled, updated_at
               ) VALUES (?, ?, ?, ?, ?, 1, ?)""",
            [(*regla, ahora) for regla in preparadas],
        )
        db.execute(
            """UPDATE reception_settings
               SET routing_mode = ?, router_profile = ?, updated_at = ?
               WHERE singleton = 1""",
            (
                routing_mode,
                AUTO_ROUTER_PROFILE if preparadas else None,
                ahora,
            ),
        )
        db.execute("COMMIT")
        comprometida = True
        return {
            "ok": True,
            "routingMode": routing_mode,
            "autoAvailable": bool(preparadas),
            "rules": len(preparadas),
        }
    finally:
        if not comprometida:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
        db.close()


def envia(connection_id, texto):
    """Durably queue one person-to-person message before reporting success."""
    connection_id, texto = _valida_salida(connection_id, texto)
    ahora = _ahora()
    message_id = str(uuid.uuid4())
    db = _conecta()
    comprometida = False
    try:
        db.execute("BEGIN IMMEDIATE")
        conexion = db.execute(
            """SELECT road_id FROM reception_connections
               WHERE connection_id = ? AND status = 'active' LIMIT 1""",
            (connection_id,),
        ).fetchone()
        if not conexion:
            raise ReceptionError("connection is not available on this computer")
        db.execute(
            """INSERT INTO reception_outbox (
                 message_id, road_id, connection_id, kind, body, created_at
               ) VALUES (?, ?, ?, 'message', ?, ?)""",
            (message_id, conexion["road_id"], connection_id, texto, ahora),
        )
        db.execute("COMMIT")
        comprometida = True
        return {
            "ok": True,
            "id": message_id,
            "status": "queued",
            "connectionId": connection_id,
        }
    finally:
        if not comprometida:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
        db.close()


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
            """SELECT state, message_kind, connection_id, road_id, remote_message_id
               FROM reception_messages WHERE message_id = ?""",
            (message_id,),
        ).fetchone()
        if not mensaje:
            raise ReceptionError("reception message not found")
        if mensaje["state"] != "pending":
            raise ReceptionError("that reception message has already been decided")
        if accion == "reject":
            respuesta_id = None
            if (
                mensaje["message_kind"] == "message"
                and mensaje["connection_id"]
                and mensaje["road_id"]
                and CONNECTION_ID.fullmatch(str(mensaje["remote_message_id"] or ""))
            ):
                respuesta_id = str(uuid.uuid4())
                db.execute(
                    """INSERT INTO reception_outbox (
                         message_id, road_id, connection_id, kind, body,
                         in_reply_to, created_at
                       ) VALUES (?, ?, ?, 'rejection', ?, ?, ?)""",
                    (
                        respuesta_id,
                        mensaje["road_id"],
                        mensaje["connection_id"],
                        motivo,
                        mensaje["remote_message_id"],
                        ahora,
                    ),
                )
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
            "responseQueued": bool(respuesta_id) if accion == "reject" else False,
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
