-- Agents City — the record of what has been built.
-- The Durable Object holds the now; this holds the before.

-- A parcel is one business unit inside one repo: a repo can hold several, and
-- that is what the whole model is about. Seeded from your data repo's parcels.yml.
CREATE TABLE IF NOT EXISTS parcela (
  id        TEXT PRIMARY KEY,          -- "org/repo:apps/checkout"
  repo      TEXT NOT NULL,
  ruta      TEXT NOT NULL,             -- glob relative to the repo, "" = the whole repo
  unidad    TEXT NOT NULL,             -- one of your units, or "none"
  nombre    TEXT NOT NULL,             -- what the house is called on the map
  dueno     TEXT,                      -- the bus user who answers for it
  UNIQUE(repo, ruta)
);
CREATE INDEX IF NOT EXISTS ix_parcela_unidad ON parcela(unidad);

-- What has been built: one row per parcel, recomputed by the cron.
CREATE TABLE IF NOT EXISTS casa (
  parcela_id   TEXT PRIMARY KEY REFERENCES parcela(id),
  pisos        INTEGER NOT NULL DEFAULT 0,   -- merged PRs (a floor per landing)
  ladrillos    INTEGER NOT NULL DEFAULT 0,   -- commits with no PR
  andamios     INTEGER NOT NULL DEFAULT 0,   -- open PRs
  andamio_viejo INTEGER NOT NULL DEFAULT 0,  -- open PRs older than 14 days
  grieta       INTEGER NOT NULL DEFAULT 0,   -- 1 = CI is red
  actividad30  INTEGER NOT NULL DEFAULT 0,   -- commits in the last 30 days
  actualizado  TEXT NOT NULL
);

-- Everything that happens, so the map can be rewound and the ticker has a feed.
CREATE TABLE IF NOT EXISTS evento (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  tipo    TEXT NOT NULL,               -- notice | floor | scaffold | crack | light
  origen  TEXT,                        -- a bus agent, or a parcel
  destino TEXT,
  etiqueta TEXT,                       -- data | ux | security | cost | product | llm
  texto   TEXT,
  leido   INTEGER NOT NULL DEFAULT 0   -- an unopened notice is the one thing worth measuring
);
CREATE INDEX IF NOT EXISTS ix_evento_ts ON evento(ts DESC);
CREATE INDEX IF NOT EXISTS ix_evento_sin_leer ON evento(leido, ts DESC);

-- The syncer's own state: how far the last pass got.
CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Who is who on the site: the architect, the specialists, and their trade.
CREATE TABLE IF NOT EXISTS persona (
  usuario TEXT PRIMARY KEY,
  nombre  TEXT NOT NULL,
  rol     TEXT NOT NULL,
  oficio  TEXT NOT NULL,
  agente  TEXT
);

-- The history of what was built, day by day: this is what the replay plays.
-- Rebuilt backwards from each PR's merge date, so you do not have to wait for
-- time to pass before you have a past.
CREATE TABLE IF NOT EXISTS hito (
  parcela_id TEXT NOT NULL,
  dia        TEXT NOT NULL,          -- "2026-08-25"
  n          INTEGER NOT NULL,       -- PRs landed THAT day
  PRIMARY KEY (parcela_id, dia)
);
-- Per day, not per month: a month is too coarse to watch anything grow.
CREATE INDEX IF NOT EXISTS ix_hito_dia ON hito(dia);

-- The districts of the city: your business units. Data, not code — so the map
-- redraws itself when the org changes shape, without a deploy.
CREATE TABLE IF NOT EXISTS unidad (
  id     TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  color  TEXT NOT NULL,          -- hex, no #
  orden  INTEGER NOT NULL DEFAULT 50,
  nota   TEXT,
  cols   INTEGER NOT NULL DEFAULT 3   -- how wide its grid is on the map
);

-- Token spend, aggregated by day and person. Counts only: never content, never
-- prompts.
--
-- Stored per person because that is the only way to deduplicate reports and to
-- attribute spend to a unit. Shown as a GLOBAL total, and never as a ranking —
-- the moment there is a leaderboard, people optimise for the leaderboard. Same
-- rule as everywhere else in this map.
CREATE TABLE IF NOT EXISTS gasto (
  dia      TEXT NOT NULL,
  usuario  TEXT NOT NULL,
  modelo   TEXT NOT NULL DEFAULT '',
  entrada  INTEGER NOT NULL DEFAULT 0,
  salida   INTEGER NOT NULL DEFAULT 0,
  cache_r  INTEGER NOT NULL DEFAULT 0,
  cache_w  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, usuario, modelo)
);
CREATE INDEX IF NOT EXISTS ix_gasto_dia ON gasto(dia DESC);

-- Goals: one per person, with the command that measures them.
--
-- The one thing that does not change whatever kind of city this is, so it lives
-- in the database and not only in a card nobody opens. Seeded from the cards,
-- which stay the place they are written and reviewed — this is a copy for the
-- map, never the source.
CREATE TABLE IF NOT EXISTS objetivo (
  usuario  TEXT NOT NULL,
  n        INTEGER NOT NULL,        -- O1, O2…
  titulo   TEXT NOT NULL,
  como     TEXT,                    -- what signal says it is going well
  medida   TEXT,                    -- the command or query, runnable as written
  partida  TEXT,                    -- what it returned the day it was agreed
  meta     TEXT,                    -- the value to reach
  cuando   TEXT,                    -- a date or a quarter
  estado   TEXT,                    -- not started | in progress | at risk | done
  PRIMARY KEY (usuario, n)
);
