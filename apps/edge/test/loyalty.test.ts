import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { BusinessRecord, LinkRecord, ReportRecord } from '@nfc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const ORIGIN = 'https://go.penginexr.com';
const BIZ = 'b_cafe00000001';
const OTHER_BIZ = 'b_otro00000001';
const SLUG = 'fideli1';
const DIRECT = 'directo';
const TOKEN = 'ReportTokenCafe000000001';
const OTHER_TOKEN = 'ReportTokenOtro000000001';
const DAY = 86_400_000;
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

interface Call {
  method?: string;
  form?: Record<string, string>;
  cookies?: string[];
  origin?: string | null;
}

async function call(path: string, init: Call = {}): Promise<Response> {
  const headers: Record<string, string> = { 'user-agent': IPHONE };
  if (init.cookies?.length) headers['cookie'] = init.cookies.join('; ');
  if (init.method === 'POST' && init.origin !== null) headers['origin'] = init.origin ?? ORIGIN;
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

/** Cookie `nombre=valor` de la respuesta (para reenviarla en la siguiente petición). */
function cookieFrom(res: Response, name: string): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = header.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Sin cookie ${name}`);
  return `${name}=${match[1]}`;
}

async function put(key: string, value: LinkRecord | BusinessRecord | ReportRecord) {
  await env.LINKS.put(key, JSON.stringify(value));
}

async function register(phone = '0991234567', cookies: string[] = []) {
  const res = await call(`/l/${SLUG}/registro`, {
    method: 'POST',
    cookies,
    form: { nombre: 'María José', telefono: phone, acepto: 'on', promos: 'on', fuente: 'nfc' },
  });
  return res;
}

async function card() {
  return env.DB.prepare(
    'SELECT id, name, phone, stamps, last_stamp_day, consent_marketing_at FROM loyalty_cards WHERE business_id = ?',
  )
    .bind(BIZ)
    .first<{
      id: number;
      name: string;
      phone: string;
      stamps: number;
      last_stamp_day: string;
      consent_marketing_at: number | null;
    }>();
}

async function setCard(fields: { stamps?: number; lastStampAt?: number; lastStampDay?: string }) {
  await env.DB.prepare(
    `UPDATE loyalty_cards SET stamps = COALESCE(?, stamps), last_stamp_at = COALESCE(?, last_stamp_at),
       last_stamp_day = COALESCE(?, last_stamp_day) WHERE business_id = ?`,
  )
    .bind(fields.stamps ?? null, fields.lastStampAt ?? null, fields.lastStampDay ?? null, BIZ)
    .run();
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM loyalty_stamps; DELETE FROM loyalty_redemptions; DELETE FROM loyalty_cards; DELETE FROM scans;',
  );
  await put(SLUG, {
    type: 'loyalty',
    url: 'https://wa.me/593999999999',
    businessId: BIZ,
    active: true,
  });
  await put(DIRECT, {
    type: 'redirect',
    url: 'https://example.com',
    businessId: BIZ,
    active: true,
  });
  await put(`business:${BIZ}`, { name: 'Café Los Andes', loyaltyVisits: 3 });
  await put(`business:${OTHER_BIZ}`, { name: 'Otro', loyaltyVisits: 5 });
  await put(`report:${TOKEN}`, { businessId: BIZ, name: 'Café Los Andes', tags: [] });
  await put(`report:${OTHER_TOKEN}`, { businessId: OTHER_BIZ, name: 'Otro', tags: [] });
});

describe('alta', () => {
  it('la primera vez muestra el formulario con las casillas de consentimiento', async () => {
    const res = await call(`/${SLUG}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Crea tu tarjeta');
    expect(html).toContain('name="acepto" required');
    expect(html).toContain('3 visitas');
  });

  it('crea la tarjeta con el primer sello y deja una cookie segura', async () => {
    const res = await register();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/l/tarjeta/${BIZ}?bienvenida=1`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/nfc_dev=[0-9A-Za-z]{32}/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(await card()).toMatchObject({
      name: 'María José',
      phone: '+593991234567',
      stamps: 1,
      consent_marketing_at: expect.any(Number),
    });
    // En la base se guarda el hash, nunca la cookie.
    const { device_hash } = (await env.DB.prepare('SELECT device_hash FROM loyalty_cards').first<{
      device_hash: string;
    }>())!;
    expect(setCookie).not.toContain(device_hash);
  });

  it('exige aceptar el consentimiento y un teléfono válido', async () => {
    const noConsent = await call(`/l/${SLUG}/registro`, {
      method: 'POST',
      form: { nombre: 'Ana', telefono: '0991234567', fuente: 'nfc' },
    });
    expect(noConsent.status).toBe(400);
    expect(await noConsent.text()).toContain('tienes que aceptar');

    const badPhone = await call(`/l/${SLUG}/registro`, {
      method: 'POST',
      form: { nombre: 'Ana', telefono: '123', acepto: 'on', fuente: 'nfc' },
    });
    expect(await badPhone.text()).toContain('teléfono no parece válido');
    expect(await card()).toBeNull();
  });

  it('el mismo número no puede registrarse en otro móvil', async () => {
    await register('0991234567');
    const res = await register('+593 99 123 4567'); // otro móvil: sin cookie
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('ya tiene una tarjeta');
  });

  it('rechaza formularios enviados desde otro sitio', async () => {
    const res = await call(`/l/${SLUG}/registro`, {
      method: 'POST',
      origin: 'https://malicioso.example',
      form: { nombre: 'Ana', telefono: '0991234567', acepto: 'on', fuente: 'nfc' },
    });
    expect(res.status).toBe(403);
    expect(await card()).toBeNull();
  });
});

describe('sellos', () => {
  async function registered() {
    return [cookieFrom(await register(), 'nfc_dev')];
  }

  it('solo un sello por día', async () => {
    const cookies = await registered();
    const res = await call(`/${SLUG}`, { cookies });
    expect(await res.text()).toContain('Ya sumaste el sello de hoy');
    expect((await card())?.stamps).toBe(1);
  });

  it('otro día suma un sello y muestra el botón para continuar', async () => {
    const cookies = await registered();
    await setCard({ lastStampDay: '2000-01-01' });
    const html = await (await call(`/${SLUG}`, { cookies })).text();
    expect(html).toContain('¡+1 sello!');
    expect(html).toContain('https://wa.me/593999999999');
    expect((await card())?.stamps).toBe(2);
  });

  it('el QR muestra la tarjeta pero nunca suma sellos', async () => {
    const cookies = await registered();
    await setCard({ lastStampDay: '2000-01-01' });
    await call(`/${SLUG}?s=q`, { cookies });
    expect((await card())?.stamps).toBe(1);
  });

  it('tras 90 días sin visitas la tarjeta vuelve a empezar', async () => {
    const cookies = await registered();
    await setCard({ stamps: 2, lastStampAt: Date.now() - 91 * DAY, lastStampDay: '2000-01-01' });
    await call(`/${SLUG}`, { cookies });
    expect((await card())?.stamps).toBe(1);
  });

  it('con la tarjeta llena no suma más y ofrece canjear', async () => {
    const cookies = await registered();
    await setCard({ stamps: 3, lastStampAt: Date.now(), lastStampDay: '2000-01-01' });
    const html = await (await call(`/${SLUG}`, { cookies })).text();
    expect(html).toContain('tu premio está listo');
    expect(html).toContain(`/l/canjear/${BIZ}`);
    expect((await card())?.stamps).toBe(3);
  });

  it('los escaneos de chips de fidelidad siguen contando en las estadísticas', async () => {
    const cookies = await registered();
    await call(`/${SLUG}`, { cookies });
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM scans WHERE slug = ?')
      .bind(SLUG)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('con el programa desactivado el chip redirige directo', async () => {
    await put(`business:${BIZ}`, { name: 'Café Los Andes', loyaltyVisits: null });
    const res = await call(`/${SLUG}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://wa.me/593999999999');
  });
});

describe('canje y validación', () => {
  async function fullCard() {
    const cookies = [cookieFrom(await register(), 'nfc_dev')];
    await setCard({ stamps: 3, lastStampAt: Date.now() });
    return cookies;
  }

  async function redeemNow(cookies: string[]) {
    const res = await call(`/l/canjear/${BIZ}`, { method: 'POST', cookies });
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    return location.split('/').pop()!;
  }

  it('canjear crea un QR único y deja la tarjeta en 0', async () => {
    const cookies = await fullCard();
    const code = await redeemNow(cookies);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect((await card())?.stamps).toBe(0);

    const page = await call(`/l/canje/${code}`, { cookies });
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('<svg');
    expect(html).toContain(`${code.slice(0, 4)}-${code.slice(4)}`);
    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);

    // Un segundo canje sin sellos no es posible.
    expect((await call(`/l/canjear/${BIZ}`, { method: 'POST', cookies })).status).toBe(409);
  });

  it('el QR del canje solo lo ve el móvil del cliente', async () => {
    const code = await redeemNow(await fullCard());
    expect((await call(`/l/canje/${code}`)).status).toBe(404);
  });

  it('no se puede canjear con la tarjeta incompleta', async () => {
    const cookies = [cookieFrom(await register(), 'nfc_dev')];
    expect((await call(`/l/canjear/${BIZ}`, { method: 'POST', cookies })).status).toBe(409);
  });

  it('el personal activa su móvil y valida el canje una sola vez', async () => {
    const code = await redeemNow(await fullCard());

    // Sin activar: no valida nada.
    const anonymous = await (await call(`/v/${code}`)).text();
    expect(anonymous).toContain('pantalla es para el personal');

    const activate = await call(`/r/${TOKEN}/validador`, { method: 'POST' });
    expect(activate.status).toBe(303);
    const staff = [cookieFrom(activate, 'nfc_staff')];

    const first = await (await call(`/v/${code}`, { cookies: staff })).text();
    expect(first).toContain('Canje válido');
    expect(first).toContain('María');
    expect(first).not.toContain('+593');

    const second = await (await call(`/v/${code}`, { cookies: staff })).text();
    expect(second).toContain('ya se usó');
  });

  it('el cliente ve en vivo que el local validó su premio', async () => {
    const cookies = await fullCard();
    const code = await redeemNow(cookies);
    const before = await (await call(`/l/canje/${code}/estado`, { cookies })).json();
    expect(before).toEqual({ validated: false });

    const staff = [
      cookieFrom(await call(`/r/${TOKEN}/validador`, { method: 'POST' }), 'nfc_staff'),
    ];
    await call(`/v/${code}`, { cookies: staff });
    const after = await (await call(`/l/canje/${code}/estado`, { cookies })).json();
    expect(after).toEqual({ validated: true });
  });

  it('el personal de otro negocio no puede validar', async () => {
    const code = await redeemNow(await fullCard());
    const staff = [
      cookieFrom(await call(`/r/${OTHER_TOKEN}/validador`, { method: 'POST' }), 'nfc_staff'),
    ];
    const res = await call(`/v/${code}`, { cookies: staff });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Código no válido');
  });

  it('el código tecleado a mano también sirve', async () => {
    const code = await redeemNow(await fullCard());
    const res = await call(`/v?codigo=${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/v/${code}`);
  });
});

describe('baja y privacidad', () => {
  it('darse de baja borra la tarjeta y libera el número', async () => {
    const cookies = [cookieFrom(await register(), 'nfc_dev')];
    const res = await call(`/l/baja/${BIZ}`, { method: 'POST', cookies });
    expect(await res.text()).toContain('Borramos tu tarjeta');
    expect(await card()).toBeNull();
    expect((await register()).status).toBe(303);
  });

  it('el enlace de estadísticas muestra cifras de fidelidad sin datos personales', async () => {
    await register();
    const html = await (await call(`/r/${TOKEN}`)).text();
    expect(html).toContain('Programa de fidelidad');
    expect(html).toContain('Usar este móvil para validar canjes');
    expect(html).toContain('Color de hoy');
    expect(html).not.toContain('María');
    expect(html).not.toContain('99123');
  });

  it('la página de privacidad existe para cada negocio', async () => {
    const html = await (await call(`/l/privacidad/${BIZ}`)).text();
    expect(html).toContain('Qué guardamos');
    expect(html).toContain('Café Los Andes');
  });
});
