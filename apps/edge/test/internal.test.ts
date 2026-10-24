import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { BusinessState, TagState } from '@nfc/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const TOKEN = 'test-internal-token-0123456789abcdef';
const BIZ = 'b_cafe00000001';
const OTHER = 'b_otro00000001';
const TOKEN_A = 'A'.repeat(24);

const business = (overrides: Partial<BusinessState> = {}): BusinessState => ({
  id: BIZ,
  name: 'Café X',
  status: 'active',
  reportToken: TOKEN_A,
  loyaltyVisits: null,
  ...overrides,
});

const tag = (overrides: Partial<TagState> = {}): TagState => ({
  slug: 'aaaaaaa',
  number: 1,
  businessId: BIZ,
  assignedAt: 100,
  label: 'Caja',
  type: 'redirect',
  targetUrl: 'https://x.ec',
  active: true,
  ...overrides,
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = TOKEN,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`https://go.penginexr.com/internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function json<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const res = await call(method, path, body);
  return { status: res.status, body: (await res.json()) as T };
}

const kv = async (key: string) => env.LINKS.get(key, 'json');

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM business_profile; DELETE FROM tag_inventory; DELETE FROM kv_published; DELETE FROM scans; DELETE FROM loyalty_stamps; DELETE FROM loyalty_redemptions; DELETE FROM loyalty_cards;',
  );
  for (const { name } of (await env.LINKS.list()).keys) await env.LINKS.delete(name);
});

describe('autenticación', () => {
  it('sin token, con token erróneo o incompleto responde 404 como cualquier ruta inexistente', async () => {
    for (const token of [null, 'otro-token-0123456789abcdef0123456789', TOKEN.slice(0, -1)]) {
      const res = await call('POST', '/sync', { revision: 1, businesses: [], tags: [] }, token);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('text/html');
    }
  });
});

describe('PUT y DELETE', () => {
  it('publica el negocio, su enlace de estadísticas y sus chips', async () => {
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    const res = await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 2 });

    expect(res.body).toEqual({ applied: true, written: 2, deleted: 0 }); // chip + reporte
    expect(await kv('aaaaaaa')).toEqual({
      type: 'redirect',
      url: 'https://x.ec',
      businessId: BIZ,
      active: true,
    });
    expect(await kv(`business:${BIZ}`)).toEqual({ name: 'Café X', loyaltyVisits: null });
    expect(await kv(`report:${TOKEN_A}`)).toEqual({
      businessId: BIZ,
      name: 'Café X',
      tags: [{ slug: 'aaaaaaa', number: 1, label: 'Caja', since: 100 }],
    });
  });

  it('repetir el mismo estado no escribe nada en KV', async () => {
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 2 });
    const again = await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 3 });
    expect(again.body).toEqual({ applied: true, written: 0, deleted: 0 });
  });

  it('ignora un envío atrasado (revisión menor o igual)', async () => {
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    await json('PUT', '/tags/aaaaaaa', { ...tag({ targetUrl: 'https://nuevo.ec' }), revision: 5 });
    const late = await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 4 });

    expect(late.body).toEqual({ applied: false, written: 0, deleted: 0 });
    expect(await kv('aaaaaaa')).toMatchObject({ url: 'https://nuevo.ec' });
  });

  it('un borrado no se deshace con un envío atrasado', async () => {
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 2 });
    await json('DELETE', '/tags/aaaaaaa?revision=3');
    await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 2 });

    expect(await kv('aaaaaaa')).toBeNull();
    expect(await kv(`report:${TOKEN_A}`)).toMatchObject({ tags: [] });
  });

  it('reasignar un chip lo mueve del enlace de un negocio al del otro', async () => {
    const tokenB = 'B'.repeat(24);
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    await json('PUT', `/businesses/${OTHER}`, {
      ...business({ id: OTHER, name: 'Otro', reportToken: tokenB }),
      revision: 2,
    });
    await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 3 });
    await json('PUT', '/tags/aaaaaaa', { ...tag({ businessId: OTHER }), revision: 4 });

    expect(await kv(`report:${TOKEN_A}`)).toMatchObject({ tags: [] });
    expect(await kv(`report:${tokenB}`)).toMatchObject({ tags: [{ slug: 'aaaaaaa' }] });
    expect(await kv('aaaaaaa')).toMatchObject({ businessId: OTHER });
  });

  it('pausar el negocio publica sus chips inactivos; regenerar el token borra el enlace viejo', async () => {
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 2 });
    const tokenNew = 'C'.repeat(24);
    await json('PUT', `/businesses/${BIZ}`, {
      ...business({ status: 'paused', reportToken: tokenNew }),
      revision: 3,
    });

    expect(await kv('aaaaaaa')).toMatchObject({ active: false });
    expect(await kv(`report:${TOKEN_A}`)).toBeNull();
    expect(await kv(`report:${tokenNew}`)).not.toBeNull();
  });

  it('borrar el negocio retira sus claves', async () => {
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    await json('DELETE', `/businesses/${BIZ}?revision=2`);
    expect(await kv(`business:${BIZ}`)).toBeNull();
    expect(await kv(`report:${TOKEN_A}`)).toBeNull();
  });

  it('rechaza un cuerpo que no coincide con la ruta o no es válido', async () => {
    expect((await call('PUT', '/tags/bbbbbbb', { ...tag(), revision: 1 })).status).toBe(400);
    expect(
      (await call('PUT', '/tags/aaaaaaa', { ...tag({ targetUrl: 'http://x.ec' }), revision: 1 }))
        .status,
    ).toBe(400);
  });
});

describe('POST /sync', () => {
  it('deja KV exactamente como la foto, borra claves sobrantes y la segunda vez no escribe', async () => {
    await env.LINKS.put('viejo01', JSON.stringify({ type: 'redirect' })); // escrita por la Pi antes
    const body = {
      revision: 10,
      businesses: [business()],
      tags: [tag(), tag({ slug: 'libre01', number: 2, businessId: null, targetUrl: null })],
    };

    const first = await json('POST', '/sync', body);
    expect(first.body).toEqual({ tags: 1, businesses: 1, reports: 1, written: 3, deleted: 1 });
    expect(await kv('viejo01')).toBeNull();

    const second = await json('POST', '/sync', { ...body, revision: 11 });
    expect(second.body).toEqual({ tags: 1, businesses: 1, reports: 1, written: 0, deleted: 0 });
  });

  it('lo que no viene en la foto se da por borrado', async () => {
    await json('PUT', `/businesses/${BIZ}`, { ...business(), revision: 1 });
    await json('PUT', '/tags/aaaaaaa', { ...tag(), revision: 2 });
    await json('POST', '/sync', { revision: 3, businesses: [business()], tags: [] });
    expect(await kv('aaaaaaa')).toBeNull();
  });
});

describe('consultas', () => {
  it('estadísticas de un chip desde su asignación, sin bots', async () => {
    await env.DB.prepare(
      `INSERT INTO scans (slug, ts, source, os, is_bot) VALUES
       ('aaaaaaa', 50, 'nfc', 'ios', 0), ('aaaaaaa', 150, 'qr', 'android', 0),
       ('aaaaaaa', 160, 'nfc', 'ios', 1)`,
    ).run();
    const res = await json('GET', '/tags/aaaaaaa/scans?since=100');
    expect(res.body).toMatchObject({ since: 100, total: 1, qr: 1, android: 1, bots: 1 });
  });

  it('tarjetas: las caducadas cuentan 0 sellos; borrar es por negocio y en transacción', async () => {
    const now = Date.now();
    const insert = (biz: string, phone: string, last: number) =>
      env.DB.prepare(
        `INSERT INTO loyalty_cards (business_id, device_hash, name, phone, consent_card_at,
           consent_marketing_at, stamps, last_stamp_at, created_at)
         VALUES (?, ?, 'Ana', ?, 1, 1, 4, ?, 1)`,
      )
        .bind(biz, `h-${phone}`, phone, last)
        .run();
    await insert(BIZ, '+593991111111', now);
    await insert(BIZ, '+593992222222', now - 100 * 86_400_000);
    await insert(OTHER, '+593993333333', now);

    const cards = await json<{ cards: Array<{ id: number; stamps: number; expired: boolean }> }>(
      'GET',
      `/businesses/${BIZ}/loyalty/cards`,
    );
    expect(cards.body.cards.map((c) => [c.stamps, c.expired])).toEqual([
      [4, false],
      [0, true],
    ]);

    const other = await env.DB.prepare('SELECT id FROM loyalty_cards WHERE business_id = ?')
      .bind(OTHER)
      .first<{ id: number }>();
    const wrong = await json('DELETE', `/businesses/${BIZ}/loyalty/cards/${other!.id}`);
    expect(wrong.body).toEqual({ deleted: false });

    const mine = await json(
      'DELETE',
      `/businesses/${BIZ}/loyalty/cards/${cards.body.cards[0]!.id}`,
    );
    expect(mine.body).toEqual({ deleted: true });
  });
});
