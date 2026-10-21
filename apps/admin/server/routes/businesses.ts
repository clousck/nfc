import { buildReportUrl, generateId, generateReportToken, reportKey } from '@nfc/shared';
import { asc, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { businesses, tags, type Business } from '../db/schema.js';
import type { AppDeps, AppEnv } from '../context.js';
import { syncBusinesses, unpublish } from '../sync.js';
import { BusinessCreate, BusinessUpdate, validate } from '../validation.js';

export function businessRoutes({ db, linkStore, publicBaseUrl }: AppDeps) {
  const app = new Hono<AppEnv>();

  const present = (business: Business) => ({
    ...business,
    reportUrl: business.reportToken ? buildReportUrl(publicBaseUrl, business.reportToken) : null,
  });

  const findBusiness = (id: string) =>
    db.select().from(businesses).where(eq(businesses.id, id)).get();

  app.get('/', (c) => {
    const rows = db.select().from(businesses).orderBy(desc(businesses.createdAt)).all();
    return c.json(rows.map(present));
  });

  app.post('/', validate('json', BusinessCreate), async (c) => {
    const body = c.req.valid('json');
    const row = db
      .insert(businesses)
      .values({
        ...body,
        id: generateId('b'),
        reportToken: generateReportToken(),
        createdAt: Date.now(),
      })
      .returning()
      .get();
    // Publica el enlace de estadísticas para que funcione desde el primer momento.
    const sync = await syncBusinesses(db, linkStore, [row.id]);
    return c.json({ ...present(row), sync }, 201);
  });

  app.get('/:id', (c) => {
    const row = findBusiness(c.req.param('id'));
    if (!row) return c.json({ error: 'not_found' }, 404);
    const businessTags = db
      .select()
      .from(tags)
      .where(eq(tags.businessId, row.id))
      .orderBy(asc(tags.number))
      .all();
    return c.json({ ...present(row), tags: businessTags });
  });

  app.patch('/:id', validate('json', BusinessUpdate), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const row =
      Object.keys(body).length > 0
        ? db.update(businesses).set(body).where(eq(businesses.id, id)).returning().get()
        : findBusiness(id);
    if (!row) return c.json({ error: 'not_found' }, 404);
    // El estado y el nombre afectan a sus chips y a su enlace de estadísticas.
    const sync = await syncBusinesses(db, linkStore, [id]);
    return c.json({ ...present(row), sync });
  });

  /** Crea o regenera el enlace privado de estadísticas; el anterior deja de funcionar. */
  app.post('/:id/report-token', async (c) => {
    const id = c.req.param('id');
    const current = findBusiness(id);
    if (!current) return c.json({ error: 'not_found' }, 404);
    const row = db
      .update(businesses)
      .set({ reportToken: generateReportToken() })
      .where(eq(businesses.id, id))
      .returning()
      .get();
    if (!row) return c.json({ error: 'not_found' }, 404);
    const removed = current.reportToken
      ? await unpublish(linkStore, [reportKey(current.reportToken)])
      : ({ ok: true } as const);
    const published = await syncBusinesses(db, linkStore, [id]);
    const sync = removed.ok ? published : removed;
    return c.json({ ...present(row), sync });
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const [assigned] = db.select({ n: count() }).from(tags).where(eq(tags.businessId, id)).all();
    if (assigned && assigned.n > 0) {
      return c.json(
        {
          error: 'has_tags',
          message: 'El negocio tiene chips asignados. Libéralos o marca el negocio como cancelado.',
        },
        409,
      );
    }
    const deleted = db.delete(businesses).where(eq(businesses.id, id)).returning().get();
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    if (deleted.reportToken) {
      const sync = await unpublish(linkStore, [reportKey(deleted.reportToken)]);
      if (!sync.ok) console.error('No se pudo retirar el enlace de estadísticas', sync.error);
    }
    return c.body(null, 204);
  });

  return app;
}
