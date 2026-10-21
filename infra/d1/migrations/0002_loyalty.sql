-- Programa de fidelidad (ver docs/LOYALTY.md).
-- Una tarjeta por cliente y negocio; el móvil se reconoce por una cookie cuyo hash
-- se guarda en device_hash (nunca el valor de la cookie).

CREATE TABLE IF NOT EXISTS loyalty_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,             -- SHA-256 de la cookie del navegador
  name TEXT NOT NULL,
  phone TEXT NOT NULL,                   -- E.164
  consent_card_at INTEGER NOT NULL,      -- consentimiento obligatorio (epoch ms)
  consent_marketing_at INTEGER,          -- NULL = no acepta promociones
  stamps INTEGER NOT NULL DEFAULT 0,     -- sellos actuales (vuelve a 0 al canjear o caducar)
  last_stamp_at INTEGER,                 -- epoch ms del último sello
  last_stamp_day TEXT,                   -- día local (YYYY-MM-DD) del último sello
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, phone),
  UNIQUE (business_id, device_hash)
);

-- Historial de sellos (para estadísticas); se borra con la tarjeta.
CREATE TABLE IF NOT EXISTS loyalty_stamps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES loyalty_cards(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loyalty_stamps_business_ts ON loyalty_stamps(business_id, ts);

-- Canjes de premio. validated_at lo marca el local (opcional) al escanear el QR.
CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER REFERENCES loyalty_cards(id) ON DELETE SET NULL,
  business_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  visits_required INTEGER NOT NULL,
  -- Sin datos personales aquí: el nombre se lee de la tarjeta (al darse de baja desaparece).
  created_at INTEGER NOT NULL,
  validated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_business_ts
  ON loyalty_redemptions(business_id, created_at);
