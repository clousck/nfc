-- Registro de escaneos (NFC / QR). Sin IP ni datos personales.
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  ts INTEGER NOT NULL,             -- epoch ms
  source TEXT NOT NULL,            -- nfc | qr
  os TEXT,                         -- ios | android | other
  country TEXT,
  city TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scans_slug_ts ON scans(slug, ts);
