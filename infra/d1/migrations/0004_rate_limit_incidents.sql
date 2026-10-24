-- Incidentes de límite de peticiones (ver docs/SECURITY.md §4).
-- Se escribe como máximo una fila por minuto y origen: un ataque no se convierte en miles de
-- escrituras. Sin IPs: source_hash = SHA-256(sal del día + origen), truncado.

CREATE TABLE IF NOT EXISTS rate_limit_incidents (
  business_id TEXT NOT NULL,      -- '' si no se sabe a qué negocio iba
  action TEXT NOT NULL,           -- signup | redeem | validate
  actor TEXT NOT NULL,            -- customer | staff | anonymous
  scope TEXT NOT NULL,            -- device | network | staff (qué límite se alcanzó)
  mode TEXT NOT NULL,             -- observe | enforce
  minute INTEGER NOT NULL,        -- inicio del minuto (epoch ms)
  source_hash TEXT NOT NULL,
  PRIMARY KEY (business_id, action, actor, scope, mode, minute, source_hash)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_incidents_minute ON rate_limit_incidents(minute);

-- Sal aleatoria de cada día para source_hash. La del día anterior se borra: a partir de ahí
-- ni con la base completa se puede saber qué origen produjo cada hash.
CREATE TABLE IF NOT EXISTS daily_salts (
  day TEXT PRIMARY KEY,           -- YYYY-MM-DD (UTC)
  salt TEXT NOT NULL
);
