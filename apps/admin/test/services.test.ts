import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../server/db/client.js';
import type { Business, Tag } from '../server/db/schema.js';
import { toBusinessDto, toTagDto } from '../server/presenters.js';
import { createServices, type Services } from '../server/services/index.js';
import { FakeLinkStore } from './helpers.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

// Los servicios se prueban sin HTTP: entra un dato, sale un resultado con tipo.
describe('servicios', () => {
  let services: Services;
  let store: FakeLinkStore;
  let close: () => void;

  beforeEach(() => {
    const opened = openDb(':memory:', migrationsFolder);
    close = opened.close;
    store = new FakeLinkStore();
    services = createServices({ db: opened.db, linkStore: store });
  });

  afterEach(() => close());

  const newBusiness = async (name = 'Café X') =>
    (await services.businesses.create({ name })).business;

  const newTag = async (input: Parameters<Services['tags']['create']>[0]) => {
    const result = await services.tags.create(input);
    if (!result.ok) throw new Error(result.error);
    return result.tag;
  };

  it('no borra un chip bloqueado', async () => {
    const tag = await newTag({ type: 'redirect' });
    expect(services.tags.lock(tag.slug).ok).toBe(true);
    expect(await services.tags.delete(tag.slug)).toEqual({ ok: false, error: 'locked' });
    expect(services.tags.get(tag.slug)).not.toBeNull();
  });

  it('bloquear dos veces devuelve la fecha del primer bloqueo', async () => {
    const tag = await newTag({ type: 'redirect' });
    const first = services.tags.lock(tag.slug);
    if (!first.ok) throw new Error(first.error);
    expect(services.tags.lock(tag.slug)).toEqual({
      ok: false,
      error: 'already_locked',
      lockedAt: first.tag.lockedAt,
    });
  });

  it('reasignar a otro negocio reinicia las estadísticas; editar sin reasignar no', async () => {
    const a = await newBusiness('A');
    const b = await newBusiness('B');
    const tag = await newTag({ type: 'redirect', businessId: a.id, targetUrl: 'https://a.ec' });
    const since = tag.assignedAt;

    const relabeled = await services.tags.update(tag.slug, { label: 'Caja' });
    if (!relabeled.ok) throw new Error(relabeled.error);
    expect(relabeled.tag.assignedAt).toBe(since);

    await new Promise((resolve) => setTimeout(resolve, 2));
    const moved = await services.tags.update(tag.slug, { businessId: b.id });
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.tag.assignedAt).toBeGreaterThan(since!);

    const freed = await services.tags.update(tag.slug, { businessId: null });
    if (!freed.ok) throw new Error(freed.error);
    expect(freed.tag.assignedAt).toBeNull();
    expect(freed.published).toBe(false);
  });

  it('rechaza asignar a un negocio inexistente', async () => {
    expect(await services.tags.create({ type: 'redirect', businessId: 'b_noexiste1' })).toEqual({
      ok: false,
      error: 'business_not_found',
    });
  });

  it('un negocio con chips no se borra', async () => {
    const business = await newBusiness();
    await newTag({ type: 'redirect', businessId: business.id, targetUrl: 'https://x.ec' });
    expect(await services.businesses.delete(business.id)).toEqual({ ok: false, error: 'has_tags' });
  });

  it('los chips de fidelidad no tienen QR', async () => {
    const tag = await newTag({ type: 'loyalty' });
    expect(services.tags.qrTarget(tag.slug)).toEqual({ ok: false, error: 'loyalty_no_qr' });
  });

  it('la lista indica qué chips están publicados', async () => {
    const business = await newBusiness();
    const live = await newTag({
      type: 'redirect',
      businessId: business.id,
      targetUrl: 'https://x.ec',
    });
    const free = await newTag({ type: 'redirect' });
    const bySlug = new Map(services.tags.list().map((row) => [row.tag.slug, row.published]));
    expect(bySlug.get(live.slug)).toBe(true);
    expect(bySlug.get(free.slug)).toBe(false);
    expect(store.link(live.slug)?.active).toBe(true);
  });
});

describe('DTOs', () => {
  it('una columna nueva en la base no se filtra a la API', () => {
    const business = {
      id: 'b_12345678',
      name: 'Café X',
      contactName: null,
      phone: null,
      plan: 'basic',
      status: 'active',
      notes: null,
      reportToken: null,
      loyaltyVisits: null,
      createdAt: 1,
      passwordHash: 'secreto',
    } as Business;
    expect(toBusinessDto(business, 'https://go.penginexr.com')).not.toHaveProperty('passwordHash');

    const tag = { slug: 'abc1234', number: 1, internalNote: 'x' } as unknown as Tag;
    expect(toTagDto(tag, false, 'https://go.penginexr.com')).not.toHaveProperty('internalNote');
  });
});
