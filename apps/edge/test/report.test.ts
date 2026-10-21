import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { ReportRecord } from '@nfc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { queryReportStats } from '../src/report.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx';
const ECUADOR = -300;
// 2026-10-21 15:30 en Ecuador (20:30 UTC).
const NOW = Date.parse('2026-10-21T20:30:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const REPORT: ReportRecord = {
  businessId: 'b_0123456789ab',
  name: 'Café <X> & "Amigos"',
  tags: [
    { slug: 'chipAAA', number: 1, label: 'Caja', since: null },
    { slug: 'chipBBB', number: 2, label: null, since: NOW - 2 * DAY },
  ],
};

async function addScan(slug: string, ts: number, extra: Partial<Record<string, unknown>> = {}) {
  await env.DB.prepare(
    'INSERT INTO scans (slug, ts, source, os, country, city, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      slug,
      ts,
      extra['source'] ?? 'nfc',
      extra['os'] ?? 'ios',
      'EC',
      'Ibarra',
      extra['isBot'] ? 1 : 0,
    )
    .run();
}

async function call(path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://go.penginexr.com${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM scans');
  await env.LINKS.delete(`report:${TOKEN}`);
});

describe('estadísticas del reporte', () => {
  it('agrupa por día y hora local de Ecuador', async () => {
    await addScan('chipAAA', NOW); // hoy 15:30 local
    await addScan('chipAAA', Date.parse('2026-10-21T04:30:00Z')); // 23:30 local del día 20
    await addScan('chipAAA', NOW - 29 * DAY); // primer día de la ventana
    await addScan('chipAAA', NOW - 31 * DAY); // fuera de la ventana

    const stats = await queryReportStats(env.DB, REPORT, NOW, ECUADOR);

    expect(stats.days).toHaveLength(30);
    expect(stats.days[29]).toEqual({ date: '2026-10-21', count: 1 });
    expect(stats.days[28]).toEqual({ date: '2026-10-20', count: 1 });
    expect(stats.days[0]).toEqual({ date: '2026-09-22', count: 1 });
    expect(stats.hours[15]).toBe(2); // hoy 15:30 y hace 29 días 15:30
    expect(stats.hours[23]).toBe(1);
    expect(stats.tags[0]).toMatchObject({ number: 1, total: 4, last30: 3, lastAt: NOW });
  });

  it('un chip solo cuenta desde que se asignó al negocio', async () => {
    await addScan('chipBBB', NOW - 3 * DAY); // antes de asignarse
    await addScan('chipBBB', NOW - HOUR);

    const stats = await queryReportStats(env.DB, REPORT, NOW, ECUADOR);

    expect(stats.tags[1]).toMatchObject({ number: 2, total: 1, last30: 1 });
  });

  it('separa NFC/QR y teléfonos, sin contar bots ni otros chips', async () => {
    await addScan('chipAAA', NOW - HOUR, { source: 'nfc', os: 'ios' });
    await addScan('chipAAA', NOW - HOUR, { source: 'qr', os: 'android' });
    await addScan('chipAAA', NOW - HOUR, { source: 'qr', os: 'other' });
    await addScan('chipAAA', NOW - HOUR, { isBot: true });
    await addScan('otroChp', NOW - HOUR);

    const stats = await queryReportStats(env.DB, REPORT, NOW, ECUADOR);

    expect(stats).toMatchObject({ nfc: 1, qr: 2, ios: 1, android: 1, other: 1 });
  });

  it('un negocio sin chips no consulta D1', async () => {
    const stats = await queryReportStats(env.DB, { ...REPORT, tags: [] }, NOW, ECUADOR);
    expect(stats.days.every((d) => d.count === 0)).toBe(true);
  });
});

describe('GET /r/:token', () => {
  it('muestra la página del negocio, privada y sin caché', async () => {
    await env.LINKS.put(`report:${TOKEN}`, JSON.stringify(REPORT));
    await addScan('chipAAA', Date.now() - HOUR);

    const res = await call(`/r/${TOKEN}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(html).toContain('Escaneos por día');
    expect(html).toContain('#1');
    // El nombre del negocio se escapa.
    expect(html).toContain('Café &lt;X&gt; &amp; &quot;Amigos&quot;');
    expect(html).not.toContain('<X>');
  });

  it('un token inexistente o con formato inválido muestra la página genérica', async () => {
    for (const path of [`/r/${TOKEN}`, '/r/corto', '/r/../../etc']) {
      const res = await call(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('Este enlace no está disponible');
    }
  });

  it('visitar el reporte no registra escaneos', async () => {
    await env.LINKS.put(`report:${TOKEN}`, JSON.stringify(REPORT));
    await call(`/r/${TOKEN}`);
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM scans').all<{
      n: number;
    }>();
    expect(results[0]?.n).toBe(0);
  });
});
