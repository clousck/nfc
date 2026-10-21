import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => {
  ctx.close();
});

const DAY = 86_400_000;

async function createBusiness(name = 'Café X') {
  return (await ctx.json<{ id: string }>('POST', '/api/businesses', { name })).body;
}

function addCard(
  businessId: string,
  card: { name: string; phone: string; stamps: number; lastStampAt: number; marketing: boolean },
) {
  const now = Date.now();
  return ctx.scans.sqlite
    .prepare(
      `INSERT INTO loyalty_cards (business_id, device_hash, name, phone, consent_card_at,
         consent_marketing_at, stamps, last_stamp_at, last_stamp_day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-21', ?)`,
    )
    .run(
      businessId,
      `hash-${card.phone}`,
      card.name,
      card.phone,
      now,
      card.marketing ? now : null,
      card.stamps,
      card.lastStampAt,
      now,
    ).lastInsertRowid;
}

describe('programa de fidelidad: configuración', () => {
  it('activar el programa publica las visitas del negocio', async () => {
    const business = await createBusiness();
    expect(ctx.store.data.get(`business:${business.id}`)).toEqual({
      name: 'Café X',
      loyaltyVisits: null,
    });

    const res = await ctx.json('PATCH', `/api/businesses/${business.id}`, { loyaltyVisits: 6 });
    expect(res.status).toBe(200);
    expect(ctx.store.data.get(`business:${business.id}`)).toEqual({
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
    expect(ctx.store.data.get(tag.slug)).toEqual({
      type: 'loyalty',
      url: null,
      businessId: business.id,
      active: true,
    });

    await ctx.json('PATCH', `/api/tags/${tag.slug}`, { targetUrl: 'https://wa.me/593' });
    expect(ctx.store.link(tag.slug)).toMatchObject({ type: 'loyalty', url: 'https://wa.me/593' });
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
    expect(ctx.store.data.has(`business:${business.id}`)).toBe(false);
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

  it('lista las tarjetas; las caducadas cuentan 0 sellos', async () => {
    const business = await createBusiness();
    await ctx.json('PATCH', `/api/businesses/${business.id}`, { loyaltyVisits: 6 });
    addCard(business.id, {
      name: 'Ana',
      phone: '+593991111111',
      stamps: 4,
      lastStampAt: Date.now(),
      marketing: true,
    });
    addCard(business.id, {
      name: 'Luis',
      phone: '+593992222222',
      stamps: 5,
      lastStampAt: Date.now() - 100 * DAY,
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
      lastStampAt: Date.now(),
      marketing: true,
    });
    addCard(business.id, {
      name: 'Sin permiso',
      phone: '+593992222222',
      stamps: 1,
      lastStampAt: Date.now(),
      marketing: false,
    });

    const res = await ctx.request('GET', `/api/businesses/${business.id}/loyalty/contacts.csv`);
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    const csv = await res.text();

    expect(res.headers.get('content-type')).toContain('text/csv');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM para Excel
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('+593991111111');
    expect(csv).not.toContain('Sin permiso');
  });

  it('borra una tarjeta a pedido y libera el número', async () => {
    const business = await createBusiness();
    const id = addCard(business.id, {
      name: 'Ana',
      phone: '+593991111111',
      stamps: 2,
      lastStampAt: Date.now(),
      marketing: true,
    });

    const res = await ctx.request('DELETE', `/api/businesses/${business.id}/loyalty/cards/${id}`);

    expect(res.status).toBe(200);
    const left = ctx.scans.sqlite.prepare('SELECT COUNT(*) AS n FROM loyalty_cards').get() as {
      n: number;
    };
    expect(left.n).toBe(0);
  });

  it('no borra tarjetas de otro negocio', async () => {
    const mine = await createBusiness('Mío');
    const other = await createBusiness('Otro');
    const id = addCard(other.id, {
      name: 'Ana',
      phone: '+593991111111',
      stamps: 2,
      lastStampAt: Date.now(),
      marketing: true,
    });
    await ctx.request('DELETE', `/api/businesses/${mine.id}/loyalty/cards/${id}`);
    const left = ctx.scans.sqlite.prepare('SELECT COUNT(*) AS n FROM loyalty_cards').get() as {
      n: number;
    };
    expect(left.n).toBe(1);
  });

  it('explica cómo arreglarlo si la llave no tiene permiso para modificar D1', async () => {
    const business = await createBusiness();
    ctx.scans.query = async () => {
      throw new Error('Cloudflare API POST /query → 403 (10000: Authentication error)');
    };
    const res = await ctx.json('DELETE', `/api/businesses/${business.id}/loyalty/cards/1`);
    expect(res.status).toBe(502);
    expect(String(res.body['message'])).toContain('de «Read» a «Edit»');
  });
});
