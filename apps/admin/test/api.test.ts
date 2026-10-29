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
    expect(ctx.edge.link(tag.slug)?.active).toBe(true);

    const res = await ctx.json<{ sync: { ok: boolean } }>(
      'PATCH',
      `/api/businesses/${business.id}`,
      { status: 'paused' },
    );
    expect(res.body.sync.ok).toBe(true);
    expect(ctx.edge.link(tag.slug)).toEqual({
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
    expect(ctx.edge.linkKeys()).toEqual([]);
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
    expect(ctx.edge.link(tag.slug)).toEqual({
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
    expect(ctx.edge.link(tag.slug)).toMatchObject({ url: 'https://b.example.com' });
  });

  it('liberar un chip lo elimina de KV', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { businessId: null });
    expect(ctx.edge.data.has(tag.slug)).toBe(false);
  });

  it('rechaza destinos que no sean https', async () => {
    const res = await ctx.json('POST', '/api/tags', { targetUrl: 'http://example.com' });
    expect(res.status).toBe(400);
  });

  it('rechaza negocios inexistentes', async () => {
    const res = await ctx.json('POST', '/api/tags', { businessId: 'b_doesnotexist' });
    expect(res.status).toBe(422);
  });

  it('si el Worker falla, guarda, deja el cambio en cola y lo publica al reintentar', async () => {
    const business = await createBusiness();
    ctx.edge.failing = true;

    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });

    expect(tag.sync).toEqual({
      ok: false,
      error: 'No se pudo contactar con el Worker (simulado)',
    });
    expect(tag.syncedAt).toBeNull();
    const stored = await ctx.json<TagBody>('GET', `/api/tags/${tag.slug}`);
    expect(stored.body.targetUrl).toBe('https://a.example.com');
    const status = await ctx.json<{ pending: number; failing: number }>('GET', '/api/sync/status');
    expect(status.body).toMatchObject({ pending: 1, failing: 1 });

    ctx.edge.failing = false;
    await ctx.publisher.publish([`tag:${tag.slug}`]);
    expect(ctx.edge.link(tag.slug)).toMatchObject({ url: 'https://a.example.com' });
    expect((await ctx.json('GET', '/api/sync/status')).body).toMatchObject({ pending: 0 });
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
    expect(ctx.edge.data.has(tag.slug)).toBe(false);
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
  const stats = (since: number | null, total: number) => ({
    since,
    total,
    nfc: total,
    qr: 0,
    ios: total,
    android: 0,
    other: 0,
    bots: 0,
    lastAt: null,
    recent: [],
  });

  it('pide al Worker los escaneos desde la asignación del chip', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    const assigned = await ctx.json<{ assignedAt: number }>('GET', `/api/tags/${tag.slug}`);
    ctx.edge.scanStats.set(tag.slug, stats(assigned.body.assignedAt, 3));

    const res = await ctx.json<{ total: number }>('GET', `/api/tags/${tag.slug}/scans`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(ctx.edge.calls).toContain(`GET scans:${tag.slug}`);
  });

  it('al reasignar el chip, la fecha desde la que se cuenta cambia', async () => {
    const first = await createBusiness('Negocio A');
    const second = await createBusiness('Negocio B');
    const tag = await createTag({ businessId: first.id, targetUrl: 'https://a.example.com' });
    const before = await ctx.json<{ assignedAt: number }>('GET', `/api/tags/${tag.slug}`);

    await new Promise((r) => setTimeout(r, 5));
    const patched = await ctx.json<{ assignedAt: number }>('PATCH', `/api/tags/${tag.slug}`, {
      businessId: second.id,
    });
    expect(patched.body.assignedAt).toBeGreaterThan(before.body.assignedAt);

    const res = await ctx.json<{ since: number }>('GET', `/api/tags/${tag.slug}/scans`);
    expect(res.body.since).toBe(patched.body.assignedAt);
  });

  it('editar otros campos no reinicia el conteo', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    const original = await ctx.json<{ assignedAt: number }>('GET', `/api/tags/${tag.slug}`);
    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { label: 'Mesa 1', businessId: business.id });
    const updated = await ctx.json<{ assignedAt: number }>('GET', `/api/tags/${tag.slug}`);
    expect(updated.body.assignedAt).toBe(original.body.assignedAt);
  });

  it('si el Worker falla responde 502 con el motivo', async () => {
    const tag = await createTag();
    ctx.edge.failing = true;
    const res = await ctx.json('GET', `/api/tags/${tag.slug}/scans`);
    expect(res.status).toBe(502);
    expect(String(res.body['message'])).toContain('No se pudo contactar con el Worker');
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
    // El Worker conoce un chip que ya no existe en la Pi.
    ctx.edge.tags.set('orphan1', {
      slug: 'orphan1',
      number: 99,
      businessId: business.id,
      assignedAt: null,
      label: null,
      type: 'redirect',
      targetUrl: 'https://old.example.com',
      active: true,
    });

    const res = await ctx.json('POST', '/api/sync');

    // 1 chip + 1 enlace de estadísticas + 1 registro del negocio; el chip huérfano desaparece.
    expect(res.body).toMatchObject({ ok: true, published: 3, tags: 1, businesses: 1, reports: 1 });
    expect(ctx.edge.linkKeys()).toEqual([tag.slug]);
  });

  it('responde 502 si el Worker falla', async () => {
    ctx.edge.failing = true;
    const res = await ctx.json('POST', '/api/sync');
    expect(res.status).toBe(502);
    expect(res.body['ok']).toBe(false);
  });
});

describe('CSRF', () => {
  it('rechaza cambios enviados desde otro sitio y acepta los del propio panel', async () => {
    const created = await ctx.json('POST', '/api/businesses', { name: 'Café CSRF' });
    const id = (created.body as { id: string }).id;
    const cross = await ctx.request('POST', `/api/businesses/${id}/report-token`, undefined, {
      'sec-fetch-site': 'cross-site',
    });
    expect(cross.status).toBe(403);
    const same = await ctx.request('POST', `/api/businesses/${id}/report-token`, undefined, {
      'sec-fetch-site': 'same-origin',
    });
    expect(same.status).not.toBe(403);
    const read = await ctx.request('GET', '/api/businesses', undefined, {
      'sec-fetch-site': 'cross-site',
    });
    expect(read.status).toBe(200);
  });
});
