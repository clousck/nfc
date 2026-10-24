import type {
  LoyaltyCardsResponse,
  LoyaltyContactsResponse,
  TagScanStatsResponse,
} from '@nfc/shared';
import { isExpired } from '../loyalty/store.js';

// Consultas que antes hacía la Pi con SQL directo contra D1 (vía API de Cloudflare).
// Ahora D1 tiene un solo dueño: el Worker.

interface SummaryRow {
  total: number | null;
  nfc: number | null;
  qr: number | null;
  ios: number | null;
  android: number | null;
  bots: number | null;
  last_at: number | null;
}

/** Escaneos de un chip desde `since` (asignación al negocio actual), sin contar bots. */
export async function tagScanStats(
  db: D1Database,
  slug: string,
  since: number | null,
  recentLimit: number,
): Promise<TagScanStatsResponse> {
  const from = since ?? 0;
  const [summary, recent] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT
           SUM(is_bot = 0)                       AS total,
           SUM(is_bot = 0 AND source = 'nfc')    AS nfc,
           SUM(is_bot = 0 AND source = 'qr')     AS qr,
           SUM(is_bot = 0 AND os = 'ios')        AS ios,
           SUM(is_bot = 0 AND os = 'android')    AS android,
           SUM(is_bot = 1)                       AS bots,
           MAX(CASE WHEN is_bot = 0 THEN ts END) AS last_at
         FROM scans WHERE slug = ? AND ts >= ?`,
      )
      .bind(slug, from),
    db
      .prepare(
        `SELECT ts, source, os, country, city FROM scans
         WHERE slug = ? AND ts >= ? AND is_bot = 0 ORDER BY ts DESC LIMIT ?`,
      )
      .bind(slug, from, recentLimit),
  ]);
  const s = (summary?.results[0] ?? {}) as Partial<SummaryRow>;
  const total = Number(s.total ?? 0);
  const ios = Number(s.ios ?? 0);
  const android = Number(s.android ?? 0);
  return {
    since,
    total,
    nfc: Number(s.nfc ?? 0),
    qr: Number(s.qr ?? 0),
    ios,
    android,
    other: total - ios - android,
    bots: Number(s.bots ?? 0),
    lastAt: s.last_at == null ? null : Number(s.last_at),
    recent: (recent?.results ?? []) as TagScanStatsResponse['recent'],
  };
}

interface CardRow {
  id: number;
  name: string;
  phone: string;
  stamps: number;
  last_stamp_at: number | null;
  consent_marketing_at: number | null;
  created_at: number;
  redemptions: number;
}

export async function loyaltyCards(
  db: D1Database,
  businessId: string,
  now: number,
): Promise<LoyaltyCardsResponse> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.stamps, c.last_stamp_at, c.consent_marketing_at,
              c.created_at,
              (SELECT COUNT(*) FROM loyalty_redemptions r WHERE r.card_id = c.id) AS redemptions
       FROM loyalty_cards c WHERE c.business_id = ?
       ORDER BY c.last_stamp_at DESC LIMIT 1000`,
    )
    .bind(businessId)
    .all<CardRow>();
  return {
    cards: results.map((r) => {
      const expired = isExpired({ lastStampAt: r.last_stamp_at }, now);
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        stamps: expired ? 0 : r.stamps,
        expired,
        lastVisitAt: r.last_stamp_at,
        marketing: r.consent_marketing_at !== null,
        createdAt: r.created_at,
        redemptions: Number(r.redemptions),
      };
    }),
  };
}

/** Contactos que aceptaron promociones (la Pi arma el CSV para el negocio). */
export async function loyaltyContacts(
  db: D1Database,
  businessId: string,
): Promise<LoyaltyContactsResponse> {
  const { results } = await db
    .prepare(
      `SELECT name, phone, consent_marketing_at FROM loyalty_cards
       WHERE business_id = ? AND consent_marketing_at IS NOT NULL ORDER BY name`,
    )
    .bind(businessId)
    .all<{ name: string; phone: string; consent_marketing_at: number }>();
  return {
    contacts: results.map((r) => ({
      name: r.name,
      phone: r.phone,
      marketingAt: r.consent_marketing_at,
    })),
  };
}

/**
 * Borrado a pedido desde el panel, en una transacción: o se borra todo (sellos, vínculo de
 * los canjes y tarjeta) o nada. Solo afecta a tarjetas de ese negocio.
 */
export async function deleteCardOfBusiness(
  db: D1Database,
  businessId: string,
  cardId: number,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare('DELETE FROM loyalty_stamps WHERE card_id = ? AND business_id = ?')
      .bind(cardId, businessId),
    db
      .prepare(
        'UPDATE loyalty_redemptions SET card_id = NULL WHERE card_id = ? AND business_id = ?',
      )
      .bind(cardId, businessId),
    db
      .prepare('DELETE FROM loyalty_cards WHERE id = ? AND business_id = ?')
      .bind(cardId, businessId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}
