import { LOYALTY_EXPIRY_DAYS } from '@nfc/shared';
import { Hono } from 'hono';
import type { LoyaltyCardDto, LoyaltyDto } from '../contracts.js';
import type { AppEnv, RouteDeps } from '../context.js';

const EXPIRY_MS = LOYALTY_EXPIRY_DAYS * 86_400_000;

interface CardRow {
  id: number;
  name: string;
  phone: string;
  stamps: number;
  last_stamp_at: number | null;
  consent_marketing_at: number | null;
  created_at: number;
  redemptions: number;
}

function d1Error(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b403\b|10000|Authentication|not authorized/i.test(message)) {
    return 'La llave de Cloudflare no tiene permiso para modificar D1. En Cloudflare, cambia el permiso D1 de «Read» a «Edit» en la llave del panel.';
  }
  return `No se pudo consultar Cloudflare: ${message}`;
}

/** Campo CSV seguro: comillas escapadas y sin fórmulas (=, +, -, @) que Excel ejecutaría. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Tarjetas de fidelidad de un negocio (datos en D1, escritos por el Worker). */
export function loyaltyRoutes({ businesses, scanStore }: RouteDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    if (!scanStore) {
      return c.json(
        { error: 'd1_unavailable', message: 'D1 no está configurada (CF_D1_DATABASE_ID).' },
        503,
      );
    }
    await next();
  });

  const businessOr404 = (id: string) => businesses.find(id);

  app.get('/:id/loyalty', async (c) => {
    const business = businessOr404(c.req.param('id'));
    if (!business) return c.json({ error: 'not_found' }, 404);
    try {
      const rows = await scanStore!.query<CardRow>(
        `SELECT c.id, c.name, c.phone, c.stamps, c.last_stamp_at, c.consent_marketing_at,
                c.created_at,
                (SELECT COUNT(*) FROM loyalty_redemptions r WHERE r.card_id = c.id) AS redemptions
         FROM loyalty_cards c WHERE c.business_id = ?
         ORDER BY c.last_stamp_at DESC LIMIT 1000`,
        [business.id],
      );
      const now = Date.now();
      const body: LoyaltyDto = {
        visits: business.loyaltyVisits,
        cards: rows.map((r): LoyaltyCardDto => {
          const expired = r.last_stamp_at !== null && now - r.last_stamp_at > EXPIRY_MS;
          return {
            id: r.id,
            name: r.name,
            phone: r.phone,
            stamps: expired ? 0 : r.stamps,
            expired,
            lastVisitAt: r.last_stamp_at,
            marketing: r.consent_marketing_at !== null,
            createdAt: r.created_at,
            redemptions: Number(r.redemptions),
          };
        }),
      };
      return c.json(body);
    } catch (err) {
      return c.json({ error: 'd1_failed', message: d1Error(err) }, 502);
    }
  });

  /** Contactos que aceptaron promociones, para entregárselos al negocio. */
  app.get('/:id/loyalty/contacts.csv', async (c) => {
    const business = businessOr404(c.req.param('id'));
    if (!business) return c.json({ error: 'not_found' }, 404);
    try {
      const rows = await scanStore!.query<{
        name: string;
        phone: string;
        consent_marketing_at: number;
      }>(
        `SELECT name, phone, consent_marketing_at FROM loyalty_cards
         WHERE business_id = ? AND consent_marketing_at IS NOT NULL ORDER BY name`,
        [business.id],
      );
      const lines = [
        ['Nombre', 'Teléfono', 'Aceptó promociones el'].map(csvField).join(','),
        ...rows.map((r) =>
          [r.name, r.phone, new Date(r.consent_marketing_at).toISOString().slice(0, 10)]
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
      return c.json({ error: 'd1_failed', message: d1Error(err) }, 502);
    }
  });

  /** Borrado a pedido del cliente (o para liberar su número si cambió de móvil). */
  app.delete('/:id/loyalty/cards/:cardId{[0-9]+}', async (c) => {
    const business = businessOr404(c.req.param('id'));
    if (!business) return c.json({ error: 'not_found' }, 404);
    const cardId = Number(c.req.param('cardId'));
    try {
      // Mismo orden que la baja desde la tarjeta: sellos, desvincular canjes, tarjeta.
      await scanStore!.query('DELETE FROM loyalty_stamps WHERE card_id = ? AND business_id = ?', [
        cardId,
        business.id,
      ]);
      await scanStore!.query(
        'UPDATE loyalty_redemptions SET card_id = NULL WHERE card_id = ? AND business_id = ?',
        [cardId, business.id],
      );
      await scanStore!.query('DELETE FROM loyalty_cards WHERE id = ? AND business_id = ?', [
        cardId,
        business.id,
      ]);
      return c.json({ deleted: cardId });
    } catch (err) {
      return c.json({ error: 'd1_failed', message: d1Error(err) }, 502);
    }
  });

  return app;
}
