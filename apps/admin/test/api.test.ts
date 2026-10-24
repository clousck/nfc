import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => {
  ctx.close();
});

interface BusinessBody {
  id: string;
  name: string;
  status: string;
}

interface TagBody {
  slug: string;
  number: number;
  businessId: string | null;
  targetUrl: string | null;
  syncedAt: number | null;
  lockedAt: number | null;
  published: boolean;
  urls: { nfc: string; qr: string };
  sync: { ok: boolean; error?: string };
}

async function createBusiness(name = 'Café X') {
  const { status, body } = await ctx.json<BusinessBody>('POST', '/api/businesses', { name });
  expect(status).toBe(201);
  return body;
}

async function createTag(payload: Record<string, unknown> = {}) {
  const { status, body } = await ctx.json<TagBody>('POST', '/api/tags', payload);
  expect(status).toBe(201);
  return body;
}

describe('health', () => {
  it('GET /health → ok', async () => {
    const res = await ctx.request('GET', '/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

describe('negocios', () => {
  it('crea, lista, obtiene y actualiza', async () => {
    const business = await createBusiness();
    expect(business.id).toMatch(/^b_[0-9A-Za-z]{12}$/);
    expect(business.status).toBe('active');
    expect(business.name).toBe('Café X');

    const list = await ctx.json<BusinessBody[]>('GET', '/api/businesses');
    expect(list.body.map((b) => b.id)).toEqual([business.id]);

    const updated = await ctx.json<BusinessBody>('PATCH', `/api/businesses/${business.id}`, {
      name: 'Café Y',
    });
    expect(updated.body.name).toBe('Café Y');

    const detail = await ctx.json<BusinessBody & { tags: unknown[] }>(
      'GET',
      `/api/businesses/${business.id}`,
    );
    expect(detail.body.tags).toEqual([]);
  });

  it('valida el cuerpo', async () => {
    const { status, body } = await ctx.json('POST', '/api/businesses', { name: '' });
    expect(status).toBe(400);
    expect(body['error']).toBe('validation');
  });

  it('no borra un negocio con chips asignados', async () => {
    const business = await createBusiness();
    await createTag({ businessId: business.id });
    const res = await ctx.request('DELETE', `/api/businesses/${business.id}`);
    expect(res.status).toBe(409);
  });

  it('borra un negocio sin chips', async () => {
    const business = await createBusiness();
    const res = await ctx.request('DELETE', `/api/businesses/${business.id}`);
    expect(res.status).toBe(204);
    expect((await ctx.request('GET', `/api/businesses/${business.id}`)).status).toBe(404);
  });

  it('pausar un negocio publica sus chips como inactivos', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://g.page/r/X' });
    expect(ctx.store.link(tag.slug)?.active).toBe(true);

    const res = await ctx.json<{ sync: { ok: boolean } }>(
      'PATCH',
      `/api/businesses/${business.id}`,
      { status: 'paused' },
    );
    expect(res.body.sync.ok).toBe(true);
    expect(ctx.store.link(tag.slug)).toEqual({
      type: 'redirect',
      url: 'https://g.page/r/X',
      businessId: business.id,
      active: false,
    });
  });
});

describe('chips', () => {
  it('crea un chip de inventario sin publicarlo', async () => {
    const tag = await createTag({ label: 'Stand 1' });
    expect(tag.slug).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(tag.businessId).toBeNull();
    expect(tag.published).toBe(false);
    expect(tag.urls).toEqual({
      nfc: `https://go.penginexr.com/${tag.slug}`,
      qr: `https://go.penginexr.com/${tag.slug}?s=q`,
    });
    expect(ctx.store.linkKeys()).toEqual([]);
  });

  it('asignar un chip con destino lo publica en KV y marca synced_at', async () => {
    const business = await createBusiness();
    const tag = await createTag();

    const res = await ctx.json<TagBody>('PATCH', `/api/tags/${tag.slug}`, {
      businessId: business.id,
      targetUrl: 'https://wa.me/593999999999',
      label: 'Caja principal',
    });

    expect(res.status).toBe(200);
    expect(res.body.published).toBe(true);
    expect(res.body.sync.ok).toBe(true);
    expect(res.body.syncedAt).toEqual(expect.any(Number));
    expect(ctx.store.link(tag.slug)).toEqual({
      type: 'redirect',
      url: 'https://wa.me/593999999999',
      businessId: business.id,
      active: true,
    });
  });

  it('cambiar el destino actualiza KV', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { targetUrl: 'https://b.example.com' });
    expect(ctx.store.link(tag.slug)).toMatchObject({ url: 'https://b.example.com' });
  });

  it('liberar un chip lo elimina de KV', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { businessId: null });
    expect(ctx.store.data.has(tag.slug)).toBe(false);
  });

  it('rechaza destinos que no sean https', async () => {
    const res = await ctx.json('POST', '/api/tags', { targetUrl: 'http://example.com' });
    expect(res.status).toBe(400);
  });

  it('rechaza negocios inexistentes', async () => {
    const res = await ctx.json('POST', '/api/tags', { businessId: 'b_doesnotexist' });
    expect(res.status).toBe(422);
  });

  it('si Cloudflare falla, guarda en SQLite y reporta el error sin synced_at', async () => {
    const business = await createBusiness();
    ctx.store.failing = true;

    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });

    expect(tag.sync).toEqual({ ok: false, error: 'Cloudflare API caída' });
    expect(tag.syncedAt).toBeNull();
    const stored = await ctx.json<TagBody>('GET', `/api/tags/${tag.slug}`);
    expect(stored.body.targetUrl).toBe('https://a.example.com');
  });

  it('filtra por negocio y por inventario', async () => {
    const business = await createBusiness();
    const assigned = await createTag({ businessId: business.id });
    const free = await createTag();

    const byBusiness = await ctx.json<TagBody[]>('GET', `/api/tags?businessId=${business.id}`);
    expect(byBusiness.body.map((t) => t.slug)).toEqual([assigned.slug]);

    const unassigned = await ctx.json<TagBody[]>('GET', '/api/tags?unassigned=true');
    expect(unassigned.body.map((t) => t.slug)).toEqual([free.slug]);
  });

  it('bloquea un chip y entonces impide borrarlo', async () => {
    const tag = await createTag();
    const locked = await ctx.json<TagBody>('POST', `/api/tags/${tag.slug}/lock`);
    expect(locked.body.lockedAt).toEqual(expect.any(Number));
    expect((await ctx.request('POST', `/api/tags/${tag.slug}/lock`)).status).toBe(409);
    expect((await ctx.request('DELETE', `/api/tags/${tag.slug}`)).status).toBe(409);
  });

  it('borra un chip no bloqueado y lo elimina de KV', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    const res = await ctx.request('DELETE', `/api/tags/${tag.slug}`);
    expect(res.status).toBe(200);
    expect(ctx.store.data.has(tag.slug)).toBe(false);
    expect((await ctx.request('GET', `/api/tags/${tag.slug}`)).status).toBe(404);
  });
});

describe('número de chip', () => {
  it('asigna números correlativos desde 1', async () => {
    const a = await createTag();
    const b = await createTag();
    const c = await createTag();
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3]);
  });

  it('no reutiliza el número de un chip borrado', async () => {
    await createTag();
    const second = await createTag();
    await ctx.request('DELETE', `/api/tags/${second.slug}`);
    const third = await createTag();
    expect(third.number).toBe(3);
  });

  it('lista los chips del más nuevo al más antiguo', async () => {
    await createTag();
    await createTag();
    const list = await ctx.json<TagBody[]>('GET', '/api/tags');
    expect(list.body.map((t) => t.number)).toEqual([2, 1]);
  });

  it('busca un chip por número', async () => {
    await createTag();
    const second = await createTag({ label: 'Mesa 2' });
    const found = await ctx.json<TagBody>('GET', '/api/tags/number/2');
    expect(found.status).toBe(200);
    expect(found.body.slug).toBe(second.slug);
    expect((await ctx.request('GET', '/api/tags/number/99')).status).toBe(404);
  });
});

describe('escaneos', () => {
  interface Stats {
    since: number | null;
    total: number;
    nfc: number;
    qr: number;
    ios: number;
    android: number;
    other: number;
    bots: number;
    lastAt: number | null;
    recent: Array<{ ts: number; source: string; os: string; city: string }>;
  }

  it('resume los escaneos del chip sin contar bots', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    const t0 = Date.now();
    ctx.scans.add({ slug: tag.slug, ts: t0 + 1, source: 'nfc', os: 'ios' });
    ctx.scans.add({ slug: tag.slug, ts: t0 + 2, source: 'qr', os: 'android', city: 'Quito' });
    ctx.scans.add({ slug: tag.slug, ts: t0 + 3, source: 'nfc', os: 'other' });
    ctx.scans.add({ slug: tag.slug, ts: t0 + 4, isBot: true });
    ctx.scans.add({ slug: 'otroChp', ts: t0 + 5 });

    const res = await ctx.json<Stats>('GET', `/api/tags/${tag.slug}/scans`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 3,
      nfc: 2,
      qr: 1,
      ios: 1,
      android: 1,
      other: 1,
      bots: 1,
      lastAt: t0 + 3,
    });
    expect(res.body.recent.map((s) => s.ts)).toEqual([t0 + 3, t0 + 2, t0 + 1]);
    expect(res.body.recent[1]).toMatchObject({ source: 'qr', os: 'android', city: 'Quito' });
  });

  it('un chip sin escaneos devuelve ceros', async () => {
    const tag = await createTag();
    const res = await ctx.json<Stats>('GET', `/api/tags/${tag.slug}/scans`);
    expect(res.body).toMatchObject({ total: 0, nfc: 0, qr: 0, bots: 0, lastAt: null, recent: [] });
  });

  it('al reasignar el chip, el nuevo negocio no ve escaneos anteriores', async () => {
    const first = await createBusiness('Negocio A');
    const second = await createBusiness('Negocio B');
    const tag = await createTag({ businessId: first.id, targetUrl: 'https://a.example.com' });
    ctx.scans.add({ slug: tag.slug, ts: Date.now() - 1000 });

    const before = await ctx.json<Stats>('GET', `/api/tags/${tag.slug}/scans`);
    expect(before.body.total).toBe(0); // escaneo previo a la asignación

    await new Promise((r) => setTimeout(r, 5));
    const patched = await ctx.json<TagBody & { assignedAt: number }>(
      'PATCH',
      `/api/tags/${tag.slug}`,
      { businessId: second.id },
    );
    ctx.scans.add({ slug: tag.slug, ts: patched.body.assignedAt + 1 });

    const after = await ctx.json<Stats>('GET', `/api/tags/${tag.slug}/scans`);
    expect(after.body.since).toBe(patched.body.assignedAt);
    expect(after.body.total).toBe(1);
  });

  it('editar otros campos no reinicia el conteo', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    const original = await ctx.json<{ assignedAt: number }>('GET', `/api/tags/${tag.slug}`);
    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { label: 'Mesa 1', businessId: business.id });
    const updated = await ctx.json<{ assignedAt: number }>('GET', `/api/tags/${tag.slug}`);
    expect(updated.body.assignedAt).toBe(original.body.assignedAt);
  });

  it('si D1 falla responde 502 con el motivo', async () => {
    const tag = await createTag();
    ctx.scans.failing = true;
    const res = await ctx.json('GET', `/api/tags/${tag.slug}/scans`);
    expect(res.status).toBe(502);
    expect(String(res.body['message'])).toContain('D1 caída');
  });
});

describe('QR', () => {
  it('genera SVG con la URL de QR', async () => {
    const tag = await createTag();
    const res = await ctx.request('GET', `/api/tags/${tag.slug}/qr`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('content-disposition')).toBe(
      `inline; filename="chip-${tag.number}-${tag.slug}-qr.svg"`,
    );
    expect(await res.text()).toMatch(/^<svg/);
  });

  it('genera PNG descargable', async () => {
    const tag = await createTag();
    const res = await ctx.request('GET', `/api/tags/${tag.slug}/qr?format=png&size=256&download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('404 para chips inexistentes', async () => {
    expect((await ctx.request('GET', '/api/tags/zzzzzzz/qr')).status).toBe(404);
  });
});

describe('re-sincronizar todo', () => {
  it('reescribe KV y borra claves huérfanas', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    await createTag(); // inventario: no se publica
    ctx.store.data.clear();
    ctx.store.data.set('orphan1', {
      type: 'redirect',
      url: 'https://old.example.com',
      businessId: business.id,
      active: true,
    });

    const res = await ctx.json('POST', '/api/sync');

    // 1 chip + 1 enlace de estadísticas + 1 registro del negocio; la clave huérfana se borra.
    expect(res.body).toEqual({
      ok: true,
      published: 3,
      tags: 1,
      businesses: 1,
      reports: 1,
      deleted: 1,
    });
    expect(ctx.store.linkKeys()).toEqual([tag.slug]);
  });

  it('responde 502 si Cloudflare falla', async () => {
    ctx.store.failing = true;
    const res = await ctx.json('POST', '/api/sync');
    expect(res.status).toBe(502);
    expect(res.body['ok']).toBe(false);
  });
});
