import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsSync } from '../server/settings-sync.js';
import { setup } from './helpers.js';

// Ajustes del negocio (destino, etiqueta, pausa, visitas del premio): su dueño es D1.
// El panel los cambia a través del Worker y guarda una copia que se refresca sola.

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => ctx.close());

interface TagBody {
  slug: string;
  label: string | null;
  targetUrl: string | null;
  pausedAt: number | null;
  active: boolean;
}

async function assignedTag() {
  const business = (await ctx.json<{ id: string }>('POST', '/api/businesses', { name: 'Café X' }))
    .body;
  const tag = (
    await ctx.json<TagBody>('POST', '/api/tags', {
      businessId: business.id,
      targetUrl: 'https://x.ec',
      label: 'Caja',
    })
  ).body;
  return { business, tag };
}

describe('ajustes de un chip asignado', () => {
  it('se guardan en el Worker y la copia local se actualiza', async () => {
    const { tag } = await assignedTag();
    const res = await ctx.json<TagBody>('PATCH', `/api/tags/${tag.slug}`, {
      targetUrl: 'https://menu.ec',
    });
    expect(res.status).toBe(200);
    expect(res.body.targetUrl).toBe('https://menu.ec');
    expect(ctx.edge.calls).toContain(`PUT settings:${tag.slug}`);
    expect(ctx.edge.link(tag.slug)).toMatchObject({ url: 'https://menu.ec' });
  });

  it('sin Worker no se guarda nada y se explica por qué', async () => {
    const { tag } = await assignedTag();
    ctx.edge.failing = true;
    const res = await ctx.json<{ error: string; message: string }>(
      'PATCH',
      `/api/tags/${tag.slug}`,
      { label: 'Barra', active: false },
    );
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('edge_unavailable');
    const local = await ctx.json<TagBody>('GET', `/api/tags/${tag.slug}`);
    expect(local.body).toMatchObject({ label: 'Caja', active: true });
  });

  it('un cambio del dueño llega a la copia local y la Pi no lo pisa', async () => {
    const { tag } = await assignedTag();
    ctx.edge.ownerChangesTag(tag.slug, { targetUrl: 'https://dueno.ec', pausedAt: 123 });

    await createSettingsSync({ db: ctx.db, edge: ctx.edge }).pull();
    const local = await ctx.json<TagBody>('GET', `/api/tags/${tag.slug}`);
    expect(local.body).toMatchObject({ targetUrl: 'https://dueno.ec', pausedAt: 123 });

    // Un cambio de inventario y un "Re-sincronizar todo" no deshacen lo del dueño.
    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { active: true });
    await ctx.json('POST', '/api/sync');
    expect(ctx.edge.link(tag.slug)).toMatchObject({ url: 'https://dueno.ec', active: false });
  });

  it('el admin puede reactivar un chip pausado por el negocio', async () => {
    const { tag } = await assignedTag();
    ctx.edge.ownerChangesTag(tag.slug, { pausedAt: 123 });
    const res = await ctx.json<TagBody>('PATCH', `/api/tags/${tag.slug}`, { paused: false });
    expect(res.body.pausedAt).toBeNull();
    expect(ctx.edge.link(tag.slug)).toMatchObject({ active: true });
  });

  it('al reasignar, el destino nuevo viaja con el chip y los ajustes viejos se descartan', async () => {
    const { tag } = await assignedTag();
    ctx.edge.ownerChangesTag(tag.slug, { label: 'Del primero', pausedAt: 123 });
    const other = (await ctx.json<{ id: string }>('POST', '/api/businesses', { name: 'Otro' }))
      .body;

    const res = await ctx.json<TagBody>('PATCH', `/api/tags/${tag.slug}`, {
      businessId: other.id,
      targetUrl: 'https://otro.ec',
    });
    expect(res.status).toBe(200);
    expect(ctx.edge.calls).not.toContain(`PUT settings:${tag.slug}`);
    expect(ctx.edge.link(tag.slug)).toMatchObject({
      businessId: other.id,
      url: 'https://otro.ec',
      active: true,
    });
  });

  it('si el Worker aún no sabe la asignación (en cola), los ajustes viajan como semilla', async () => {
    const { tag } = await assignedTag();
    ctx.edge.reset(); // p. ej. el alta todavía no llegó
    const res = await ctx.json<TagBody>('PATCH', `/api/tags/${tag.slug}`, { label: 'Mesa 2' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Mesa 2');
  });
});

describe('visitas del premio', () => {
  it('se guardan en el Worker; sin Worker, 503 y nada cambia', async () => {
    const { business } = await assignedTag();
    const ok = await ctx.json<{ loyaltyVisits: number }>(
      'PATCH',
      `/api/businesses/${business.id}`,
      { loyaltyVisits: 6 },
    );
    expect(ok.body.loyaltyVisits).toBe(6);
    expect(ctx.edge.data.get(`business:${business.id}`)).toMatchObject({ loyaltyVisits: 6 });

    ctx.edge.failing = true;
    const failed = await ctx.json('PATCH', `/api/businesses/${business.id}`, {
      loyaltyVisits: 9,
      name: 'Otro nombre',
    });
    expect(failed.status).toBe(503);
    ctx.edge.failing = false;
    const local = await ctx.json<{ name: string; loyaltyVisits: number }>(
      'GET',
      `/api/businesses/${business.id}`,
    );
    expect(local.body).toMatchObject({ name: 'Café X', loyaltyVisits: 6 });
  });
});
