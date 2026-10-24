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

-- Identidad (docs/BUSINESS-ACCOUNTS.md §4). Las cuentas las crea el admin desde el panel; no
-- hay registro público. Una cuenta puede ser dueña de varios negocios (memberships).
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,                  -- a_<base62>
  email TEXT NOT NULL UNIQUE,           -- en minúsculas
  name TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  disabled_at INTEGER
);

CREATE TABLE IF NOT EXISTS memberships (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_business ON memberships(business_id);

-- Enlaces de acceso de un solo uso. Solo se guarda el hash del token.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,                -- email (15 min) | invite (24 h, copiado desde el panel)
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expires ON login_tokens(expires_at);

-- Sesiones del portal (cookie __Host-nfc_session, 30 días). Solo se guarda el hash.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Personal: sin cuenta, un móvil vinculado por negocio (docs/BUSINESS-ACCOUNTS.md §4).
CREATE TABLE IF NOT EXISTS staff_devices (
  id TEXT PRIMARY KEY,                  -- d_<base62>
  business_id TEXT NOT NULL,
  label TEXT NOT NULL,                  -- "Caja – María"
  token_hash TEXT NOT NULL UNIQUE,      -- hash de la cookie __Host-nfc_staff
  created_by TEXT,                      -- cuenta del dueño; NULL = admin
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_staff_devices_business ON staff_devices(business_id);

-- QR / enlace de vinculación: un solo uso, 15 minutos.
CREATE TABLE IF NOT EXISTS pairing_tokens (
  token_hash TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_expires ON pairing_tokens(expires_at);

-- Qué dispositivo validó cada canje.
ALTER TABLE loyalty_redemptions ADD COLUMN validated_by_device TEXT;

-- Ajustes globales que el admin cambia desde el panel (p. ej. a quién avisar).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
