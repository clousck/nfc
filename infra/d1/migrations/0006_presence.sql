-- Fase 5: prueba de presencia con QR rotativo (docs/BUSINESS-ACCOUNTS.md §6).
-- Subir qr_key_version invalida al instante todos los QR del negocio (p. ej. si se filtró una foto).
ALTER TABLE business_settings ADD COLUMN qr_key_version INTEGER NOT NULL DEFAULT 1;
-- Con qué método se probó la presencia de cada sello (static_nfc | rotating_qr | ntag_sun).
ALTER TABLE loyalty_stamps ADD COLUMN presence_method TEXT;
