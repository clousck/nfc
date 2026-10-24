import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  account,
  BIZ,
  business,
  cookieOf,
  internal,
  INTERNAL,
  linkIn,
  login as loginWith,
  mockMail,
  OTHER,
  portal,
  PORTAL,
  resetPortalTables,
  send,
  type SentMail,
} from './portal-helpers.js';

let mails: SentMail[];

beforeEach(async () => {
  await resetPortalTables();
  mails = mockMail();
});

afterEach(() => vi.restoreAllMocks());

const login = (email?: string) => loginWith(mails, email);

describe('portal: host y protección', () => {
  it('la API interna no existe en el host del portal', async () => {
    const res = await send(
      new Request(`${PORTAL}/internal/sync`, {
        method: 'POST',
        headers: { authorization: `Bearer ${INTERNAL}` },
      }),
    );
    expect(res.status).not.toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('sin sesión, todo lleva a /entrar', async () => {
    const res = await portal('GET', '/');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/entrar');
  });

  it('rechaza formularios enviados desde otra web (CSRF)', async () => {
    const res = await portal('POST', '/entrar', {
      form: { email: 'ana@cafe.ec' },
      site: 'cross-site',
    });
    expect(res.status).toBe(403);
  });

  it('páginas sin caché, sin indexar y sin Referer', async () => {
    const res = await portal('GET', '/entrar');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});

describe('portal: enlace mágico', () => {
  it('flujo completo: pedir, abrir (no gasta), confirmar (gasta) y entrar', async () => {
    await business(BIZ);
    await account();

    const asked = await portal('POST', '/entrar', { form: { email: ' Ana@Cafe.EC ' } });
    expect(asked.status).toBe(200);
    expect(await asked.text()).toContain('Revisa tu correo');
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toEqual(['ana@cafe.ec']);
    const path = new URL(linkIn(mails[0]?.text ?? '') ?? '').pathname;

    // Abrir el enlace (o que lo abra un filtro de correo) no lo gasta.
    expect((await portal('GET', path)).status).toBe(200);
    expect((await portal('GET', path)).status).toBe(200);

    const entered = await portal('POST', path);
    expect(entered.status).toBe(303);
    const cookie = cookieOf(entered);
    expect(cookie).toMatch(/^__Host-nfc_session=[0-9A-Za-z]{43}$/);
    expect(entered.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');

    // Un solo uso.
    expect((await portal('POST', path)).status).toBe(410);
    expect((await portal('GET', path)).status).toBe(410);

    // Con un solo negocio se entra directo a él.
    const home = await portal('GET', '/', { cookie });
    expect(home.headers.get('location')).toBe(`/n/${BIZ}`);
    const page = await portal('GET', `/n/${BIZ}`, { cookie });
    expect(await page.text()).toContain('Café X');

    const row = await env.DB.prepare('SELECT last_login_at FROM accounts').first<{
      last_login_at: number | null;
    }>();
    expect(row?.last_login_at).toBeGreaterThan(0);
  });

  it('un correo sin acceso recibe la misma respuesta y ningún correo', async () => {
    await business(BIZ);
    const res = await portal('POST', '/entrar', { form: { email: 'nadie@x.ec' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Revisa tu correo');
    expect(mails).toHaveLength(0);
  });

  it('como mucho 3 enlaces pendientes por cuenta (cuida la cuota de correo)', async () => {
    await business(BIZ);
    await account();
    for (let i = 0; i < 5; i++) await portal('POST', '/entrar', { form: { email: 'ana@cafe.ec' } });
    expect(mails).toHaveLength(3);
  });

  it('un enlace caducado no sirve', async () => {
    await business(BIZ);
    await account();
    await portal('POST', '/entrar', { form: { email: 'ana@cafe.ec' } });
    await env.DB.prepare('UPDATE login_tokens SET expires_at = 1').run();
    const path = new URL(linkIn(mails[0]?.text ?? '') ?? '').pathname;
    expect((await portal('POST', path)).status).toBe(410);
  });

  it('el enlace copiado desde el panel también sirve', async () => {
    await business(BIZ);
    const id = await account();
    const res = await internal('POST', `/businesses/${BIZ}/accounts/${id}/login-link`);
    const { url } = (await res.json()) as { url: string };
    expect((await portal('POST', new URL(url).pathname)).status).toBe(303);
  });

  it('un negocio cancelado no da acceso', async () => {
    await business(BIZ);
    await account();
    await business(BIZ, { status: 'cancelled' });
    await portal('POST', '/entrar', { form: { email: 'ana@cafe.ec' } });
    expect(mails).toHaveLength(0);
  });
});

describe('portal: sesión', () => {
  it('solo ve sus negocios; uno ajeno responde como inexistente', async () => {
    await business(BIZ);
    await business(OTHER);
    await account();
    const cookie = await login();
    expect((await portal('GET', `/n/${OTHER}`, { cookie })).status).toBe(404);
  });

  it('con varios negocios muestra la lista', async () => {
    await business(BIZ);
    await business(OTHER);
    await account();
    await account('ana@cafe.ec', OTHER);
    const cookie = await login();
    const home = await portal('GET', '/', { cookie });
    const text = await home.text();
    expect(text).toContain('Café X');
    expect(text).toContain('Otro');
  });

  it('salir revoca la sesión en el servidor (no solo borra la cookie)', async () => {
    await business(BIZ);
    await account();
    const cookie = await login();
    const out = await portal('POST', '/salir', { cookie });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await portal('GET', '/', { cookie })).headers.get('location')).toBe('/entrar');
  });

  it('quitar el acceso desde el panel corta la sesión abierta', async () => {
    await business(BIZ);
    const id = await account();
    const cookie = await login();
    await internal('DELETE', `/businesses/${BIZ}/accounts/${id}`);
    expect((await portal('GET', `/n/${BIZ}`, { cookie })).status).toBe(303);
  });
});
