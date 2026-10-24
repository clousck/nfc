import { Hono, type Context } from 'hono';
import type { LoyaltyDto } from '../contracts.js';
import type { AppEnv, RouteDeps } from '../context.js';

/** Campo CSV seguro: comillas escapadas y sin fórmulas (=, +, -, @) que Excel ejecutaría. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function edgeFailed(c: Context, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return c.json(
    { error: 'edge_failed', message: `No se pudo consultar Cloudflare: ${message}` },
    502,
  );
}

/** Tarjetas de fidelidad de un negocio (viven en D1; las consulta el Worker). */
export function loyaltyRoutes({ businesses, edge }: RouteDeps) {
  const app = new Hono<AppEnv>();

  app.get('/:id/loyalty', async (c) => {
    const business = businesses.find(c.req.param('id'));
    if (!business) return c.json({ error: 'not_found' }, 404);
    try {
      const { cards } = await edge.loyaltyCards(business.id);
      const body: LoyaltyDto = { visits: business.loyaltyVisits, cards };
      return c.json(body);
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  /** Contactos que aceptaron promociones, para entregárselos al negocio. */
  app.get('/:id/loyalty/contacts.csv', async (c) => {
    const business = businesses.find(c.req.param('id'));
    if (!business) return c.json({ error: 'not_found' }, 404);
    try {
      const { contacts } = await edge.loyaltyContacts(business.id);
      const lines = [
        ['Nombre', 'Teléfono', 'Aceptó promociones el'].map(csvField).join(','),
        ...contacts.map((r) =>
          [r.name, r.phone, new Date(r.marketingAt).toISOString().slice(0, 10)]
            .map(csvField)
            .join(','),
        ),
      ];
      const filename = `contactos-${business.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;
      // BOM (U+FEFF) para que Excel abra bien las tildes.
      return c.body(`\uFEFF${lines.join('\r\n')}\r\n`, 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      });
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  /** Borrado a pedido del cliente (o para liberar su número si cambió de móvil). */
  app.delete('/:id/loyalty/cards/:cardId{[0-9]+}', async (c) => {
    const business = businesses.find(c.req.param('id'));
    if (!business) return c.json({ error: 'not_found' }, 404);
    const cardId = Number(c.req.param('cardId'));
    try {
      // El Worker lo hace en una transacción y solo dentro de ese negocio.
      await edge.deleteLoyaltyCard(business.id, cardId);
      return c.json({ deleted: cardId });
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  return app;
}
