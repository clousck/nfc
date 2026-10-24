import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => {
  ctx.close();
});

async function createBusiness(name = 'Café X') {
  return (await ctx.json<{ id: string }>('POST', '/api/businesses', { name })).body;
}

let nextCardId = 1;

/** Tarjeta en el Worker simulado (tal como la devolvería tras calcular la caducidad). */
function addCard(
  businessId: string,
  card: { name: string; phone: string; stamps: number; expired?: boolean; marketing: boolean },
) {
  const id = nextCardId++;
  const now = Date.now();
  ctx.edge.cards.set(businessId, [
    ...(ctx.edge.cards.get(businessId) ?? []),
    {
      id,
      name: card.name,
      phone: card.phone,
      stamps: card.expired ? 0 : card.stamps,
      expired: card.expired ?? false,
      lastVisitAt: now,
      marketing: card.marketing,
      createdAt: now,
      redemptions: 0,
    },
  ]);
  if (card.marketing) {
    ctx.edge.contacts.set(businessId, [
      ...(ctx.edge.contacts.get(businessId) ?? []),
      { name: card.name, phone: card.phone, marketingAt: now },
    ]);
  }
  return id;
}

describe('programa de fidelidad: configuración', () => {
  it('activar el programa publica las visitas del negocio', async () => {
    const business = await createBusiness();
    expect(ctx.edge.data.get(`business:${business.id}`)).toEqual({
      name: 'Café X',
      loyaltyVisits: null,
    });

    const res = await ctx.json('PATCH', `/api/businesses/${business.id}`, { loyaltyVisits: 6 });
    expect(res.status).toBe(200);
    expect(ctx.edge.data.get(`business:${business.id}`)).toEqual({
      name: 'Café X',
      loyaltyVisits: 6,
    });
  });

  it('limita las visitas entre 2 y 20', async () => {
    const business = await createBusiness();
    for (const visits of [1, 21, 3.5]) {
      const res = await ctx.json('PATCH', `/api/businesses/${business.id}`, {
        loyaltyVisits: visits,
      });
      expect(res.status).toBe(400);
    }
  });

  it('los chips de fidelidad se publican con su modo y destino opcional', async () => {
    const business = await createBusiness();
    const { body: tag } = await ctx.json<{ slug: string }>('POST', '/api/tags', {
      businessId: business.id,
      type: 'loyalty',
    });
    expect(ctx.edge.data.get(tag.slug)).toEqual({
      type: 'loyalty',
      url: null,
      businessId: business.id,
      active: true,
    });

    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { targetUrl: 'https://wa.me/593' });
    expect(ctx.edge.link(tag.slug)).toMatchObject({ type: 'loyalty', url: 'https://wa.me/593' });
  });

  it('los chips de fidelidad no tienen QR', async () => {
    const business = await createBusiness();
    const { body: tag } = await ctx.json<{ slug: string }>('POST', '/api/tags', {
      businessId: business.id,
      type: 'loyalty',
    });
    const res = await ctx.json('GET', `/api/tags/${tag.slug}/qr`);
    expect(res.status).toBe(409);
    expect(res.body['error']).toBe('loyalty_no_qr');
  });

  it('borrar el negocio retira sus datos de Cloudflare', async () => {
    const business = await createBusiness();
    await ctx.request('DELETE', `/api/businesses/${business.id}`);
    expect(ctx.edge.data.has(`business:${business.id}`)).toBe(false);
  });
});

describe('programa de fidelidad: tarjetas', () => {
  interface CardsBody {
    visits: number | null;
    cards: Array<{
      id: number;
      name: string;
      stamps: number;
      expired: boolean;
      marketing: boolean;
    }>;
  }

  it('lista las tarjetas que calcula el Worker junto a las visitas del negocio', async () => {
    const business = await createBusiness();
    await ctx.json('PATCH', `/api/businesses/${business.id}`, { loyaltyVisits: 6 });
    addCard(business.id, { name: 'Ana', phone: '+593991111111', stamps: 4, marketing: true });
    addCard(business.id, {
      name: 'Luis',
      phone: '+593992222222',
      stamps: 5,
      expired: true,
      marketing: false,
    });

    const res = await ctx.json<CardsBody>('GET', `/api/businesses/${business.id}/loyalty`);

    expect(res.body.visits).toBe(6);
    expect(res.body.cards).toEqual([
      expect.objectContaining({ name: 'Ana', stamps: 4, expired: false, marketing: true }),
      expect.objectContaining({ name: 'Luis', stamps: 0, expired: true, marketing: false }),
    ]);
  });

  it('exporta solo los contactos que aceptaron promociones, sin fórmulas', async () => {
    const business = await createBusiness();
    addCard(business.id, {
      name: '=HYPERLINK("x")',
      phone: '+593991111111',
      stamps: 1,
      marketing: true,
    });
    addCard(business.id, {
      name: 'Sin permiso',
      phone: '+593992222222',
      stamps: 1,
      marketing: false,
    });

    const res = await ctx.request('GET', `/api/businesses/${business.id}/loyalty/contacts.csv`);
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    const csv = await res.text();

    expect(res.headers.get('content-type')).toContain('text/csv');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM para Excel
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('+593991111111');
    expect(csv).not.toContain('Sin permiso');
  });

  it('borra una tarjeta a pedido pidiéndoselo al Worker para ese negocio', async () => {
    const business = await createBusiness();
    const id = addCard(business.id, {
      name: 'Ana',
      phone: '+593991111111',
      stamps: 2,
      marketing: true,
    });

    const res = await ctx.request('DELETE', `/api/businesses/${business.id}/loyalty/cards/${id}`);

    expect(res.status).toBe(200);
    expect(ctx.edge.calls).toContain(`DELETE card:${business.id}:${id}`);
    expect(ctx.edge.cards.get(business.id)).toEqual([]);
  });

  it('si el Worker no responde, lo explica con 502', async () => {
    const business = await createBusiness();
    ctx.edge.failing = true;
    const res = await ctx.json('GET', `/api/businesses/${business.id}/loyalty`);
    expect(res.status).toBe(502);
    expect(String(res.body['message'])).toContain('No se pudo contactar con el Worker');
  });
});
