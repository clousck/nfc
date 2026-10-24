-- Copia del plano de control (la Pi) que el Worker necesita para publicar KV.
-- Solo la escribe la API interna /internal/* (ver docs/BUSINESS-ACCOUNTS.md §3).
-- `revision` ordena los cambios: se ignora todo envío con revisión <= la guardada.
-- `deleted` = 1 marca un borrado (lápida), para que un envío atrasado no lo resucite.

CREATE TABLE IF NOT EXISTS business_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,                 -- active | paused | cancelled
  report_token TEXT,
  loyalty_visits INTEGER,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tag_inventory (
  slug TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  business_id TEXT,
  assigned_at INTEGER,
  label TEXT,
  type TEXT NOT NULL,                   -- redirect | landing | loyalty
  target_url TEXT,
  active INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tag_inventory_business ON tag_inventory(business_id);

-- Lo que hay ahora mismo en KV, para escribir solo lo que cambia (cuota gratis: 1.000
-- escrituras/día). owner = 'tag:<slug>' o 'business:<id>'.
CREATE TABLE IF NOT EXISTS kv_published (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_published_owner ON kv_published(owner);
