import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

const INTERNAL = 'test-internal-token-0123456789abcdef';
const BIZ = 'b_cafe00000001';
const OTHER = 'b_otro00000001';
const PORTAL = 'https://negocios.penginexr.com';
const testEnv = { ...env, RESEND_API_KEY: 're_test' };

async function send(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const internal = (method: string, path: string, body?: unknown) =>
  send(
    new Request(`https://go.penginexr.com/internal${path}`, {
      method,
      headers: { authorization: `Bearer ${INTERNAL}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

function portal(
  method: string,
  path: string,
  init: { form?: Record<string, string>; cookie?: string; site?: string } = {},
) {
  const headers: Record<string, string> = { 'sec-fetch-site': init.site ?? 'same-origin' };
  if (init.cookie) headers['cookie'] = init.cookie;
  return send(
    new Request(`${PORTAL}${path}`, {
      method,
      headers,
      redirect: 'manual',
      body: init.form ? new URLSearchParams(init.form) : undefined,
    }),
  );
}

async function business(id: string, status = 'active', revision = 1) {
  await internal('PUT', `/businesses/${id}`, {
    id,
    name: id === BIZ ? 'Café X' : 'Otro',
    status,
    reportToken: null,
    loyaltyVisits: null,
    revision,
  });
}

async function account(email = 'ana@cafe.ec', businessId = BIZ) {
  const res = await internal('POST', `/businesses/${businessId}/accounts`, { email });
  return ((await res.json()) as { id: string }).id;
}

let mails: { to: string[]; text: string }[];

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM sessions; DELETE FROM login_tokens; DELETE FROM memberships; DELETE FROM accounts; DELETE FROM audit_log; DELETE FROM business_profile; DELETE FROM business_settings;',
  );
  mails = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.resend.com/emails') throw new Error(`fetch inesperado: ${url}`);
    mails.push(JSON.parse(String(init?.body)) as { to: string[]; text: string });
    return new Response('{"id":"x"}', { status: 200 });
  });
});

afterEach(() => vi.restoreAllMocks());

const linkIn = (text: string) => /https:\/\/negocios\.penginexr\.com\/entrar\/\S+/.exec(text)?.[0];
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

async function login(email = 'ana@cafe.ec'): Promise<string> {
  await portal('POST', '/entrar', { form: { email } });
  const link = linkIn(mails.at(-1)?.text ?? '');
  if (!link) throw new Error('no llegó el correo');
  const res = await portal('POST', new URL(link).pathname);
  return cookieOf(res);
}

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
    await business(BIZ, 'cancelled', 2);
    await portal('POST', '/entrar', { form: { email: 'ana@cafe.ec' } });
    expect(mails).toHaveLength(0);
  });
});

describe('portal: sesión', () => {
  it('solo ve sus negocios; uno ajeno responde como inexistente', async () => {
    await business(BIZ);
    await business(OTHER, 'active', 2);
    await account();
    const cookie = await login();
    expect((await portal('GET', `/n/${OTHER}`, { cookie })).status).toBe(404);
  });

  it('con varios negocios muestra la lista', async () => {
    await business(BIZ);
    await business(OTHER, 'active', 2);
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
