import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  account,
  BIZ,
  business,
  internal,
  login,
  mockMail,
  portal,
  resetPortalTables,
  send,
  tag,
  type SentMail,
} from './portal-helpers.js';

const GO = 'https://go.penginexr.com';
let mails: SentMail[];
let cookie: string;

beforeEach(async () => {
  await resetPortalTables();
  await env.DB.exec(
    'DELETE FROM staff_devices; DELETE FROM pairing_tokens; DELETE FROM app_settings;',
  );
  mails = mockMail();
  await business(BIZ, { loyaltyVisits: 5 });
  await tag('aaaaaaa', 1);
  await account();
  cookie = await login(mails);
});

afterEach(() => vi.restoreAllMocks());

const go = (method: string, path: string, staffCookie?: string) =>
  send(
    new Request(`${GO}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'sec-fetch-site': 'same-origin',
        ...(staffCookie ? { cookie: staffCookie } : {}),
      },
    }),
  );

/** El dueño crea el enlace en el portal; devuelve la ruta /vincular/<token>. */
async function pairingPath(label = 'Caja – María'): Promise<string> {
  const res = await portal('POST', `/n/${BIZ}/personal`, { form: { nombre: label }, cookie });
  expect(res.status).toBe(200);
  const url = /https:\/\/go\.penginexr\.com\/vincular\/[0-9A-Za-z]{43}/.exec(await res.text())?.[0];
  if (!url) throw new Error('sin enlace de vinculación');
  return new URL(url).pathname;
}

async function pair(label?: string): Promise<string> {
  const res = await go('POST', await pairingPath(label));
  expect(res.status).toBe(303);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

describe('vincular móviles del personal', () => {
  it('flujo completo: QR en el portal, el GET no gasta, el POST vincula', async () => {
    const path = await pairingPath();
    const page = await go('GET', path);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Caja – María');
    expect((await go('GET', path)).status).toBe(200);

    const done = await go('POST', path);
    expect(done.headers.get('location')).toBe('/v');
    const staff = (done.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(staff).toMatch(/^__Host-nfc_staff=[0-9A-Za-z]{43}$/);
    expect(done.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');

    // Un solo uso.
    expect((await go('POST', path)).status).toBe(410);

    const home = await (await go('GET', '/v', staff)).text();
    expect(home).toContain('Validar canjes');
    expect(home).toContain('Caja – María');
  });

  it('el portal lista los móviles y queda en la actividad', async () => {
    await pair();
    const list = await (await portal('GET', `/n/${BIZ}/personal`, { cookie })).text();
    expect(list).toContain('Caja – María');
    expect(list).toContain('ana@cafe.ec');
    const activity = await (await portal('GET', `/n/${BIZ}/actividad`, { cookie })).text();
    expect(activity).toContain('Vinculó el móvil «Caja – María»');
  });

  it('desvincular corta el acceso al instante', async () => {
    const staff = await pair();
    const { id } = (await env.DB.prepare('SELECT id FROM staff_devices').first<{ id: string }>())!;
    const res = await portal('POST', `/n/${BIZ}/personal/${id}/revocar`, { cookie });
    expect(res.headers.get('location')).toBe(`/n/${BIZ}/personal?m=vinculado_revocado`);
    expect(await (await go('GET', '/v', staff)).text()).toContain('pantalla es para el personal');
  });

  it('un enlace caducado no sirve', async () => {
    const path = await pairingPath();
    await env.DB.prepare('UPDATE pairing_tokens SET expires_at = 1').run();
    expect((await go('GET', path)).status).toBe(410);
    expect((await go('POST', path)).status).toBe(410);
  });

  it('máximo 10 móviles activos por negocio', async () => {
    for (let i = 0; i < 10; i++) await pair(`Móvil ${i}`);
    const res = await portal('POST', `/n/${BIZ}/personal`, { form: { nombre: 'Uno más' }, cookie });
    expect(res.headers.get('location')).toBe(`/n/${BIZ}/personal?m=demasiados_moviles`);
  });

  it('nombre obligatorio', async () => {
    const res = await portal('POST', `/n/${BIZ}/personal`, { form: { nombre: '  ' }, cookie });
    expect(res.headers.get('location')).toBe(`/n/${BIZ}/personal?m=nombre_invalido`);
  });
});

describe('el admin y el personal', () => {
  it('el admin lista, vincula y revoca desde la API interna', async () => {
    const created = await internal('POST', `/businesses/${BIZ}/staff/pairing`, { label: 'Barra' });
    const { url } = (await created.json()) as { url: string };
    const done = await go('POST', new URL(url).pathname);
    expect(done.status).toBe(303);

    const list = (await (await internal('GET', `/businesses/${BIZ}/staff`)).json()) as {
      devices: Array<{ id: string; label: string; createdBy: string | null }>;
    };
    expect(list.devices).toEqual([expect.objectContaining({ label: 'Barra', createdBy: null })]);

    const id = list.devices[0]?.id ?? '';
    expect((await internal('DELETE', `/businesses/${BIZ}/staff/${id}`)).status).toBe(200);
    expect((await internal('DELETE', `/businesses/${BIZ}/staff/${id}`)).status).toBe(404);
  });

  it('el correo de avisos tiene un valor por defecto y el admin lo cambia', async () => {
    const before = (await (await internal('GET', '/app-settings')).json()) as {
      adminNotifyEmail: string;
    };
    expect(before.adminNotifyEmail).toBe('admin@penginexr.com'); // el del entorno de test

    await internal('PUT', '/app-settings', { adminNotifyEmail: 'Otro@Correo.ec' });
    const sent = mails.length;
    await portal('POST', `/n/${BIZ}/chips/aaaaaaa/pausa`, { form: { accion: 'pausar' }, cookie });
    expect(mails.slice(sent)[0]?.to).toEqual(['otro@correo.ec']);

    expect((await internal('PUT', '/app-settings', { adminNotifyEmail: 'no' })).status).toBe(400);
  });
});
