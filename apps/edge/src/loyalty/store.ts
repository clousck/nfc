import { generateRedemptionCode, LOYALTY_EXPIRY_DAYS } from '@nfc/shared';

const DAY_MS = 86_400_000;
const EXPIRY_MS = LOYALTY_EXPIRY_DAYS * DAY_MS;

export interface Card {
  id: number;
  businessId: string;
  name: string;
  phone: string;
  stamps: number;
  lastStampAt: number | null;
  lastStampDay: string | null;
  createdAt: number;
}

interface CardRow {
  id: number;
  business_id: string;
  name: string;
  phone: string;
  stamps: number;
  last_stamp_at: number | null;
  last_stamp_day: string | null;
  created_at: number;
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    phone: row.phone,
    stamps: row.stamps,
    lastStampAt: row.last_stamp_at,
    lastStampDay: row.last_stamp_day,
    createdAt: row.created_at,
  };
}

const CARD_COLUMNS =
  'id, business_id, name, phone, stamps, last_stamp_at, last_stamp_day, created_at';

/** Día local YYYY-MM-DD con desplazamiento fijo en minutos (Ecuador: -300). */
export function localDay(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** ¿La tarjeta caducó por pasar 90 días sin visitas? */
export function isExpired(card: Card, now: number): boolean {
  return card.lastStampAt !== null && now - card.lastStampAt > EXPIRY_MS;
}

/** Sellos que cuentan ahora mismo (0 si caducó). */
export function effectiveStamps(card: Card, now: number): number {
  return isExpired(card, now) ? 0 : card.stamps;
}

export async function findCard(
  db: D1Database,
  businessId: string,
  deviceHash: string,
): Promise<Card | null> {
  const row = await db
    .prepare(`SELECT ${CARD_COLUMNS} FROM loyalty_cards WHERE business_id = ? AND device_hash = ?`)
    .bind(businessId, deviceHash)
    .first<CardRow>();
  return row ? toCard(row) : null;
}

export type CreateCardResult = { ok: true; card: Card } | { ok: false; reason: 'phone_taken' };

export async function createCard(
  db: D1Database,
  input: {
    businessId: string;
    deviceHash: string;
    name: string;
    phone: string;
    marketing: boolean;
    firstStamp: { slug: string } | null;
    now: number;
    offsetMinutes: number;
  },
): Promise<CreateCardResult> {
  const { now } = input;
  const stamps = input.firstStamp ? 1 : 0;
  try {
    const row = await db
      .prepare(
        `INSERT INTO loyalty_cards
           (business_id, device_hash, name, phone, consent_card_at, consent_marketing_at,
            stamps, last_stamp_at, last_stamp_day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${CARD_COLUMNS}`,
      )
      .bind(
        input.businessId,
        input.deviceHash,
        input.name,
        input.phone,
        now,
        input.marketing ? now : null,
        stamps,
        input.firstStamp ? now : null,
        input.firstStamp ? localDay(now, input.offsetMinutes) : null,
        now,
      )
      .first<CardRow>();
    if (!row) throw new Error('No se pudo crear la tarjeta');
    if (input.firstStamp) {
      await db
        .prepare('INSERT INTO loyalty_stamps (card_id, business_id, slug, ts) VALUES (?, ?, ?, ?)')
        .bind(row.id, input.businessId, input.firstStamp.slug, now)
        .run();
    }
    return { ok: true, card: toCard(row) };
  } catch (err) {
    if (String(err).includes('UNIQUE') && String(err).includes('phone')) {
      return { ok: false, reason: 'phone_taken' };
    }
    throw err;
  }
}

export type StampResult = 'added' | 'already_today' | 'reward_ready';

/** Suma el sello de hoy (máximo uno por día) respetando caducidad y el tope de visitas. */
export async function addStamp(
  db: D1Database,
  card: Card,
  input: { slug: string; visitsRequired: number; now: number; offsetMinutes: number },
): Promise<{ result: StampResult; card: Card }> {
  const { now, visitsRequired } = input;
  const today = localDay(now, input.offsetMinutes);
  const current = effectiveStamps(card, now);
  if (card.lastStampDay === today && !isExpired(card, now)) {
    return { result: 'already_today', card };
  }
  if (current >= visitsRequired) return { result: 'reward_ready', card };

  const next = current + 1;
  // Condición en el UPDATE: si dos peticiones llegan a la vez, solo una suma el sello.
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE loyalty_cards SET stamps = ?, last_stamp_at = ?, last_stamp_day = ?
         WHERE id = ? AND (last_stamp_day IS NULL OR last_stamp_day != ?)`,
      )
      .bind(next, now, today, card.id, today),
  ]);
  if (!update?.meta.changes) return { result: 'already_today', card };
  await db
    .prepare('INSERT INTO loyalty_stamps (card_id, business_id, slug, ts) VALUES (?, ?, ?, ?)')
    .bind(card.id, card.businessId, input.slug, now)
    .run();
  return {
    result: 'added',
    card: { ...card, stamps: next, lastStampAt: now, lastStampDay: today },
  };
}

export interface Redemption {
  code: string;
  businessId: string;
  cardId: number | null;
  visitsRequired: number;
  createdAt: number;
  validatedAt: number | null;
  /** Nombre del cliente (null si se dio de baja). */
  customerName: string | null;
  deviceHash: string | null;
}

/**
 * Canjea el premio: crea el código y deja la tarjeta en 0, en una sola transacción.
 * Solo funciona si la tarjeta tiene los sellos necesarios y no caducó.
 */
export async function redeem(
  db: D1Database,
  card: Card,
  input: { visitsRequired: number; now: number },
): Promise<string | null> {
  const { now, visitsRequired } = input;
  if (effectiveStamps(card, now) < visitsRequired) return null;
  const code = generateRedemptionCode();
  const minLastStamp = now - EXPIRY_MS;
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO loyalty_redemptions (card_id, business_id, code, visits_required, created_at)
         SELECT id, business_id, ?, ?, ? FROM loyalty_cards
         WHERE id = ? AND stamps >= ? AND last_stamp_at >= ?`,
      )
      .bind(code, visitsRequired, now, card.id, visitsRequired, minLastStamp),
    db
      .prepare('UPDATE loyalty_cards SET stamps = 0 WHERE id = ? AND stamps >= ?')
      .bind(card.id, visitsRequired),
  ]);
  return insert?.meta.changes ? code : null;
}

interface RedemptionRow {
  code: string;
  business_id: string;
  card_id: number | null;
  visits_required: number;
  created_at: number;
  validated_at: number | null;
  name: string | null;
  device_hash: string | null;
}

export async function findRedemption(db: D1Database, code: string): Promise<Redemption | null> {
  const row = await db
    .prepare(
      `SELECT r.code, r.business_id, r.card_id, r.visits_required, r.created_at, r.validated_at,
              c.name, c.device_hash
       FROM loyalty_redemptions r LEFT JOIN loyalty_cards c ON c.id = r.card_id
       WHERE r.code = ?`,
    )
    .bind(code)
    .first<RedemptionRow>();
  if (!row) return null;
  return {
    code: row.code,
    businessId: row.business_id,
    cardId: row.card_id,
    visitsRequired: row.visits_required,
    createdAt: row.created_at,
    validatedAt: row.validated_at,
    customerName: row.name,
    deviceHash: row.device_hash,
  };
}

/** Último canje del cliente aún sin validar (para volver a mostrarle su QR). */
export async function findPendingRedemption(db: D1Database, cardId: number, since: number) {
  return db
    .prepare(
      `SELECT code FROM loyalty_redemptions
       WHERE card_id = ? AND validated_at IS NULL AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(cardId, since)
    .first<{ code: string }>();
}

/** Marca el canje como validado por el local. Devuelve false si ya lo estaba. */
export async function validateRedemption(db: D1Database, code: string, now: number) {
  const result = await db
    .prepare(
      'UPDATE loyalty_redemptions SET validated_at = ? WHERE code = ? AND validated_at IS NULL',
    )
    .bind(now, code)
    .run();
  return result.meta.changes > 0;
}

/** Baja del cliente: borra su tarjeta, sus sellos y su nombre/teléfono. */
export async function deleteCard(db: D1Database, cardId: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM loyalty_stamps WHERE card_id = ?').bind(cardId),
    db.prepare('UPDATE loyalty_redemptions SET card_id = NULL WHERE card_id = ?').bind(cardId),
    db.prepare('DELETE FROM loyalty_cards WHERE id = ?').bind(cardId),
  ]);
}

export interface LoyaltySummary {
  cards: number;
  activeCards: number;
  stamps30: number;
  redemptions30: number;
  validated30: number;
}

/** Cifras sin datos personales para el enlace de estadísticas del negocio. */
export async function loyaltySummary(
  db: D1Database,
  businessId: string,
  now: number,
): Promise<LoyaltySummary> {
  const since30 = now - 30 * DAY_MS;
  const [cards, stamps, redemptions] = await db.batch<Record<string, number | null>>([
    db
      .prepare(
        `SELECT COUNT(*) AS cards, SUM(last_stamp_at >= ?) AS active
         FROM loyalty_cards WHERE business_id = ?`,
      )
      .bind(now - EXPIRY_MS, businessId),
    db
      .prepare('SELECT COUNT(*) AS n FROM loyalty_stamps WHERE business_id = ? AND ts >= ?')
      .bind(businessId, since30),
    db
      .prepare(
        `SELECT COUNT(*) AS n, SUM(validated_at IS NOT NULL) AS validated
         FROM loyalty_redemptions WHERE business_id = ? AND created_at >= ?`,
      )
      .bind(businessId, since30),
  ]);
  const c = cards?.results[0];
  const s = stamps?.results[0];
  const r = redemptions?.results[0];
  return {
    cards: Number(c?.['cards'] ?? 0),
    activeCards: Number(c?.['active'] ?? 0),
    stamps30: Number(s?.['n'] ?? 0),
    redemptions30: Number(r?.['n'] ?? 0),
    validated30: Number(r?.['validated'] ?? 0),
  };
}
