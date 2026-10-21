import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { LinkRecord } from '@nfc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const BUSINESS_ID = 'b_0123456789ab';

interface ScanRow {
  slug: string;
  source: string;
  os: string;
  country: string | null;
  city: string | null;
  is_bot: number;
}

async function call(
  path: string,
  init: { userAgent?: string; cf?: Record<string, unknown> } = {},
): Promise<Response> {
  const request = new Request(`https://go.penginexr.com${path}`, {
    headers: init.userAgent ? { 'user-agent': init.userAgent } : {},
    cf: init.cf,
  } as RequestInit);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function putLink(slug: string, record: LinkRecord | Record<string, unknown>): Promise<void> {
  await env.LINKS.put(slug, JSON.stringify(record));
}

async function scans(): Promise<ScanRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT slug, source, os, country, city, is_bot FROM scans ORDER BY id',
  ).all<ScanRow>();
  return results;
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM scans');
});

describe('GET /health', () => {
  it('responde 200 ok sin registrar escaneos', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(await scans()).toHaveLength(0);
  });
});

describe('GET /:slug', () => {
  it('redirige con 302 al destino y registra el escaneo NFC', async () => {
    await putLink('aB3dE5f', {
      type: 'redirect',
      url: 'https://g.page/r/XXXX/review',
      businessId: BUSINESS_ID,
      active: true,
    });

    const res = await call('/aB3dE5f', {
      userAgent: IPHONE,
      cf: { country: 'EC', city: 'Quito' },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://g.page/r/XXXX/review');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await scans()).toEqual([
      { slug: 'aB3dE5f', source: 'nfc', os: 'ios', country: 'EC', city: 'Quito', is_bot: 0 },
    ]);
  });

  it('marca el origen QR con ?s=q', async () => {
    await putLink('qrCode1', {
      type: 'redirect',
      url: 'https://wa.me/593999999999',
      businessId: BUSINESS_ID,
      active: true,
    });

    const res = await call('/qrCode1?s=q', { userAgent: ANDROID });

    expect(res.status).toBe(302);
    const [row] = await scans();
    expect(row).toMatchObject({ source: 'qr', os: 'android', is_bot: 0 });
  });

  it('registra crawlers de previsualización como bots', async () => {
    await putLink('botTest', {
      type: 'redirect',
      url: 'https://example.com',
      businessId: BUSINESS_ID,
      active: true,
    });

    await call('/botTest', { userAgent: 'WhatsApp/2.23.20.0 A' });

    const [row] = await scans();
    expect(row?.is_bot).toBe(1);
  });

  it('muestra la página de fallback si el slug no existe', async () => {
    const res = await call('/noExist', { userAgent: IPHONE });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Este enlace no está disponible');
    expect(await scans()).toHaveLength(1);
  });

  it('muestra la página de fallback si el chip está inactivo', async () => {
    await putLink('paused1', {
      type: 'redirect',
      url: 'https://example.com',
      businessId: BUSINESS_ID,
      active: false,
    });

    const res = await call('/paused1', { userAgent: IPHONE });

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Este enlace no está disponible');
  });

  it('no redirige si el registro de KV es inválido (p. ej. http://)', async () => {
    await putLink('badUrl1', {
      type: 'redirect',
      url: 'http://insecure.example.com',
      businessId: BUSINESS_ID,
      active: true,
    });

    const res = await call('/badUrl1', { userAgent: IPHONE });

    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });

  it('las landings muestran fallback hasta la Fase 3', async () => {
    await putLink('landng1', { type: 'landing', businessId: BUSINESS_ID, active: true });

    const res = await call('/landng1', { userAgent: IPHONE });

    expect(res.status).toBe(404);
  });

  it('ignora rutas con formato de slug inválido sin registrar escaneos', async () => {
    for (const path of ['/favicon.ico', '/a-b-c-d', '/', '/aB3dE5f/extra']) {
      const res = await call(path, { userAgent: IPHONE });
      expect(res.status).toBe(404);
    }
    expect(await scans()).toHaveLength(0);
  });
});
