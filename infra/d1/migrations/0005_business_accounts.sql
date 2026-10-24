-- Cuentas de negocio (docs/BUSINESS-ACCOUNTS.md, fase 4).
--
-- Lo que el negocio puede tocar vive aquí y su dueño es D1 (el Worker): destino, etiqueta y
-- pausa de cada chip, y las visitas del premio. La Pi sigue enviando esos valores en
-- tag_inventory / business_profile, pero solo como SEMILLA: se copian cuando el chip se
-- asigna a un negocio (o el negocio aparece) y a partir de ahí manda esta tabla.

CREATE TABLE IF NOT EXISTS tag_settings (
  slug TEXT PRIMARY KEY,
  -- Negocio al que pertenecen estos ajustes. Si el chip se reasigna, la fila se descarta y se
  -- vuelve a sembrar: el destino de un negocio nunca pasa al siguiente.
  business_id TEXT NOT NULL,
  target_url TEXT,
  label TEXT,
  paused_at INTEGER,                    -- "stand perdido": el chip deja de funcionar
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tag_settings_updated ON tag_settings(updated_at);

CREATE TABLE IF NOT EXISTS business_settings (
  business_id TEXT PRIMARY KEY,
  loyalty_visits INTEGER,               -- NULL = programa de fidelidad desactivado
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_business_settings_updated ON business_settings(updated_at);

-- Quién cambió qué (admin, dueño o personal), con el antes y el después.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,             -- admin | owner | staff
  actor_id TEXT,                        -- cuenta o dispositivo; NULL para el admin
  action TEXT NOT NULL,                 -- p. ej. tag.settings, business.settings
  target TEXT,                          -- slug o id afectado
  before_json TEXT,
  after_json TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_business_ts ON audit_log(business_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
