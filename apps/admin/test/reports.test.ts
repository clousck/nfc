import type { ReportRecord } from '@nfc/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => {
  ctx.close();
});

interface BusinessBody {
  id: string;
  reportToken: string | null;
  reportUrl: string | null;
}

interface TagBody {
  slug: string;
  number: number;
  assignedAt: number | null;
}

async function createBusiness(name = 'Café X') {
  return (await ctx.json<BusinessBody>('POST', '/api/businesses', { name })).body;
}

async function createTag(payload: Record<string, unknown> = {}) {
  return (await ctx.json<TagBody>('POST', '/api/tags', payload)).body;
}

function report(token: string | null): ReportRecord | undefined {
  return ctx.store.data.get(`report:${token}`) as ReportRecord | undefined;
}

describe('enlace privado de estadísticas', () => {
  it('cada negocio nuevo tiene su enlace publicado', async () => {
    const business = await createBusiness();

    expect(business.reportToken).toMatch(/^[0-9A-Za-z]{24}$/);
    expect(business.reportUrl).toBe(`https://go.penginexr.com/r/${business.reportToken}`);
    expect(report(business.reportToken)).toEqual({
      businessId: business.id,
      name: 'Café X',
      tags: [],
    });
  });

  it('los enlaces de dos negocios son distintos', async () => {
    const a = await createBusiness('A');
    const b = await createBusiness('B');
    expect(a.reportToken).not.toBe(b.reportToken);
  });

  it('incluye los chips del negocio con número, etiqueta y fecha de asignación', async () => {
    const business = await createBusiness();
    const tag = await createTag({
      businessId: business.id,
      label: 'Caja',
      targetUrl: 'https://a.example.com',
    });

    expect(report(business.reportToken)?.tags).toEqual([
      { slug: tag.slug, number: tag.number, label: 'Caja', since: tag.assignedAt },
    ]);
  });

  it('al reasignar un chip, pasa del enlace de un negocio al del otro', async () => {
    const a = await createBusiness('A');
    const b = await createBusiness('B');
    const tag = await createTag({ businessId: a.id, targetUrl: 'https://a.example.com' });

    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { businessId: b.id });

    expect(report(a.reportToken)?.tags).toEqual([]);
    expect(report(b.reportToken)?.tags.map((t) => t.slug)).toEqual([tag.slug]);
  });

  it('borrar un chip lo quita del enlace', async () => {
    const business = await createBusiness();
    const tag = await createTag({ businessId: business.id, targetUrl: 'https://a.example.com' });
    await ctx.request('DELETE', `/api/tags/${tag.slug}`);
    expect(report(business.reportToken)?.tags).toEqual([]);
  });

  it('renombrar el negocio actualiza el enlace', async () => {
    const business = await createBusiness();
    await ctx.json('PATCH', `/api/businesses/${business.id}`, { name: 'Café Y' });
    expect(report(business.reportToken)?.name).toBe('Café Y');
  });

  it('un negocio cancelado deja de tener enlace; al reactivarlo vuelve', async () => {
    const business = await createBusiness();
    await ctx.json('PATCH', `/api/businesses/${business.id}`, { status: 'cancelled' });
    expect(report(business.reportToken)).toBeUndefined();

    await ctx.json('PATCH', `/api/businesses/${business.id}`, { status: 'active' });
    expect(report(business.reportToken)).toBeDefined();
  });

  it('regenerar el enlace invalida el anterior', async () => {
    const business = await createBusiness();
    const res = await ctx.json<BusinessBody & { sync: { ok: boolean } }>(
      'POST',
      `/api/businesses/${business.id}/report-token`,
    );

    expect(res.body.sync.ok).toBe(true);
    expect(res.body.reportToken).not.toBe(business.reportToken);
    expect(report(business.reportToken)).toBeUndefined();
    expect(report(res.body.reportToken)?.businessId).toBe(business.id);
  });

  it('borrar el negocio retira su enlace', async () => {
    const business = await createBusiness();
    await ctx.request('DELETE', `/api/businesses/${business.id}`);
    expect(report(business.reportToken)).toBeUndefined();
  });

  it('re-sincronizar todo vuelve a publicar los enlaces', async () => {
    const business = await createBusiness();
    ctx.store.data.clear();
    await ctx.json('POST', '/api/sync');
    expect(report(business.reportToken)?.name).toBe('Café X');
  });
});
