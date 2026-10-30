import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectedTag } from '../src/internal/control-plane.js';
import { localDayStart, todayVisits } from '../src/portal/today.js';

const OFFSET = -300; // Ecuador
const BIZ = 'b_hoy000000001';
// 15:00 en Ecuador (20:00 UTC).
const NOW = Date.UTC(2026, 9, 30, 20, 0, 0);
const MIDNIGHT = Date.UTC(2026, 9, 30, 5, 0, 0);
const HOUR = 3_600_000;
const tags = [{ slug: 'hoy-chip' }] as ProjectedTag[];

async function stamp(businessId: string, ts: number) {
  const card = await env.DB.prepare(
    `INSERT INTO loyalty_cards (business_id, device_hash, name, phone, consent_card_at, created_at)
     VALUES (?, ?, 'Ana', ?, 0, 0) RETURNING id`,
  )
    .bind(businessId, crypto.randomUUID(), crypto.randomUUID())
    .first<{ id: number }>();
  await env.DB.prepare(
    `INSERT INTO loyalty_stamps (card_id, business_id, slug, ts) VALUES (?, ?, 'x', ?)`,
  )
    .bind(card!.id, businessId, ts)
    .run();
}

async function scan(slug: string, ts: number, isBot = 0) {
  await env.DB.prepare(`INSERT INTO scans (slug, ts, source, is_bot) VALUES (?, ?, 'nfc', ?)`)
    .bind(slug, ts, isBot)
    .run();
}

const input = (loyalty: boolean) => ({
  businessId: BIZ,
  tags,
  loyalty,
  now: NOW,
  offsetMinutes: OFFSET,
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM loyalty_stamps; DELETE FROM loyalty_cards; DELETE FROM scans;');
});

describe('la franja del día', () => {
  it('la medianoche es la local, no la de UTC', () => {
    expect(localDayStart(NOW, OFFSET)).toBe(MIDNIGHT);
    // A las 23:00 en Ecuador ya es otro día en UTC, pero sigue siendo el mismo día local.
    expect(localDayStart(MIDNIGHT + 23 * HOUR, OFFSET)).toBe(MIDNIGHT);
    expect(localDayStart(MIDNIGHT - 1, OFFSET)).toBe(MIDNIGHT - 24 * HOUR);
  });

  it('con fidelidad cuenta los sellos de hoy de ese negocio y compara con ayer a esta hora', async () => {
    await stamp(BIZ, MIDNIGHT + 8 * HOUR);
    await stamp(BIZ, MIDNIGHT + 13 * HOUR);
    await stamp('b_otro', MIDNIGHT + 9 * HOUR);
    // Ayer: uno antes de esta hora y otro después, que no debe contar.
    await stamp(BIZ, NOW - 24 * HOUR - HOUR);
    await stamp(BIZ, NOW - 24 * HOUR + HOUR);

    const today = await todayVisits(env.DB, input(true));
    expect(today.kind).toBe('stamps');
    expect(today.times).toEqual([MIDNIGHT + 8 * HOUR, MIDNIGHT + 13 * HOUR]);
    expect(today.yesterdaySameTime).toBe(1);
    expect(today.dayStart).toBe(MIDNIGHT);
  });

  it('sin fidelidad cuenta los escaneos de sus chips, sin bots', async () => {
    await scan('hoy-chip', MIDNIGHT + 10 * HOUR);
    await scan('hoy-chip', MIDNIGHT + 11 * HOUR, 1);
    await scan('de-otro', MIDNIGHT + 11 * HOUR);
    await scan('hoy-chip', NOW - 24 * HOUR - HOUR);

    const today = await todayVisits(env.DB, input(false));
    expect(today.kind).toBe('scans');
    expect(today.times).toEqual([MIDNIGHT + 10 * HOUR]);
    expect(today.yesterdaySameTime).toBe(1);
  });

  it('sin chips responde vacío', async () => {
    const today = await todayVisits(env.DB, { ...input(false), tags: [] });
    expect(today).toMatchObject({ kind: 'scans', times: [], yesterdaySameTime: 0 });
  });
});
