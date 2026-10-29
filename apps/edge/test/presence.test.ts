import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import {
  QR_WINDOW_MS,
  rotatingQr,
  rotatingQrToken,
  staticNfc,
  verifyPresencePass,
  presencePass,
} from '../src/presence/index.js';
import { seedStaffDevice } from './staff-helpers.js';

const ORIGIN = 'https://go.penginexr.com';
const BIZ = 'b_qr0000000001';
const KEY = 'test-presence-master-key-0123456789abcdef';

async function call(
  path: string,
  init: { method?: string; form?: Record<string, string>; cookies?: string[] } = {},
) {
  const headers: Record<string, string> = {};
  if (init.cookies?.length) headers['cookie'] = init.cookies.join('; ');
  if (init.method === 'POST') {
    headers['origin'] = 'null';
    headers['sec-fetch-site'] = 'same-origin';
  }
  const body = init.form ? new URLSearchParams(init.form) : undefined;
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body,
      redirect: 'manual',
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function cookieFrom(res: Response, name: string): string {
  const match = (res.headers.get('set-cookie') ?? '').match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Sin cookie ${name}`);
  return `${name}=${match[1]}`;
}

const context = (version: number | null = 1) => ({
  masterKey: KEY,
  qrKeyVersion: async () => version,
});

async function currentPath(now = Date.now()) {
  return `/c/${(await rotatingQrToken(KEY, BIZ, 1, now)).token}`;
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM loyalty_stamps; DELETE FROM loyalty_cards; DELETE FROM business_settings; DELETE FROM staff_devices;',
  );
  await env.LINKS.put(
    `business:${BIZ}`,
    JSON.stringify({ name: 'Panadería Sol', loyaltyVisits: 4 }),
  );
});

describe('verificadores', () => {
  it('el NFC estático es una prueba débil y el QR fijo no prueba nada', async () => {
    expect(await staticNfc.verify({ businessId: BIZ, source: 'nfc' }, context(), 0)).toMatchObject({
      proven: true,
      strength: 'weak',
    });
    expect(await staticNfc.verify({ businessId: BIZ, source: 'qr' }, context(), 0)).toEqual({
      proven: false,
      reason: 'missing',
    });
  });

  it('el QR rotativo vale en su ventana y la siguiente, y caduca después', async () => {
    const now = 1_800_000_000_000;
    const { token } = await rotatingQrToken(KEY, BIZ, 1, now);
    expect(await rotatingQr.verify({ token }, context(), now)).toMatchObject({
      proven: true,
      strength: 'strong',
      businessId: BIZ,
    });
    expect(await rotatingQr.verify({ token }, context(), now + QR_WINDOW_MS)).toMatchObject({
      proven: true,
    });
    expect(await rotatingQr.verify({ token }, context(), now + 2 * QR_WINDOW_MS)).toEqual({
      proven: false,
      reason: 'expired',
    });
  });

  it('rechaza firmas manipuladas, otra versión de clave y la falta de clave maestra', async () => {
    const now = Date.now();
    const { token } = await rotatingQrToken(KEY, BIZ, 1, now);
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(await rotatingQr.verify({ token: tampered }, context(), now)).toMatchObject({
      proven: false,
      reason: 'invalid',
    });
    expect(await rotatingQr.verify({ token }, context(2), now)).toMatchObject({ proven: false });
    expect(
      await rotatingQr.verify(
        { token },
        { masterKey: undefined, qrKeyVersion: async () => 1 },
        now,
      ),
    ).toMatchObject({ proven: false });
  });

  it('el pase de presencia solo vale para su negocio y durante 10 minutos', async () => {
    const now = Date.now();
    const pass = await presencePass(KEY, BIZ, now);
    expect(await verifyPresencePass(KEY, pass, BIZ, now)).toBe(true);
    expect(await verifyPresencePass(KEY, pass, 'b_otro', now)).toBe(false);
    expect(await verifyPresencePass(KEY, pass, BIZ, now + 11 * 60_000)).toBe(false);
  });
});

describe('check-in con el QR del local', () => {
  it('sin tarjeta: alta con pase de presencia y primer sello rotating_qr', async () => {
    const res = await call(await currentPath());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`action="/c/registro/${BIZ}"`);
    const pass = cookieFrom(res, 'nfc_presence');

    const created = await call(`/c/registro/${BIZ}`, {
      method: 'POST',
      cookies: [pass],
      form: { nombre: 'Ana', telefono: '0991112233', acepto: 'on', fuente: 'qr' },
    });
    expect(created.status).toBe(303);
    const stamp = await env.DB.prepare(
      'SELECT slug, presence_method FROM loyalty_stamps WHERE business_id = ?',
    )
      .bind(BIZ)
      .first<{ slug: string; presence_method: string }>();
    expect(stamp).toEqual({ slug: 'qr', presence_method: 'rotating_qr' });
  });

  it('sin pase de presencia el alta crea la tarjeta pero sin sello', async () => {
    const created = await call(`/c/registro/${BIZ}`, {
      method: 'POST',
      form: { nombre: 'Ana', telefono: '0991112233', acepto: 'on', fuente: 'qr' },
    });
    expect(created.status).toBe(303);
    const row = await env.DB.prepare('SELECT stamps FROM loyalty_cards WHERE business_id = ?')
      .bind(BIZ)
      .first<{ stamps: number }>();
    expect(row?.stamps).toBe(0);
  });

  it('con tarjeta suma el sello del día una sola vez', async () => {
    const first = await call(await currentPath());
    const created = await call(`/c/registro/${BIZ}`, {
      method: 'POST',
      cookies: [cookieFrom(first, 'nfc_presence')],
      form: { nombre: 'Ana', telefono: '0991112233', acepto: 'on', fuente: 'qr' },
    });
    const device = cookieFrom(created, 'nfc_dev');
    await env.DB.prepare("UPDATE loyalty_cards SET last_stamp_day = '2000-01-01'").run();

    const again = await call(await currentPath(), { cookies: [device] });
    expect(again.status).toBe(200);
    const twice = await call(await currentPath(), { cookies: [device] });
    expect(await twice.text()).toContain('Ya sumaste');
    const row = await env.DB.prepare('SELECT stamps FROM loyalty_cards').first<{
      stamps: number;
    }>();
    expect(row?.stamps).toBe(2);
  });

  it('un QR caducado o falso no suma nada', async () => {
    expect((await call(await currentPath(Date.now() - 5 * QR_WINDOW_MS))).status).toBe(410);
    expect((await call(`/c/${BIZ}.123.firmafalsa`)).status).toBe(404);
  });

  it('sin programa de fidelidad el QR no vale', async () => {
    await env.LINKS.put(
      `business:${BIZ}`,
      JSON.stringify({ name: 'Panadería Sol', loyaltyVisits: null }),
    );
    expect((await call(await currentPath())).status).toBe(404);
  });
});

describe('pantalla del QR para el personal', () => {
  it('un móvil vinculado ve el QR, que se recarga solo', async () => {
    const staff = await seedStaffDevice(BIZ, 'Panadería Sol');
    const res = await call('/v/qr', { cookies: [staff] });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('QR del día');
    expect(html).toContain('http-equiv="refresh"');
  });

  it('sin vincular no se ve', async () => {
    const html = await (await call('/v/qr')).text();
    expect(html).not.toContain('http-equiv="refresh"');
  });
});
