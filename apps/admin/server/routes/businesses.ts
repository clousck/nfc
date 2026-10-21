import { generateId } from '@nfc/shared';
import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { businesses, tags } from '../db/schema.js';
import type { AppDeps, AppEnv } from '../context.js';
import { syncBusinessTags } from '../sync.js';
import { BusinessCreate, BusinessUpdate, validate } from '../validation.js';

export function businessRoutes({ db, linkStore }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const rows = db.select().from(businesses).orderBy(desc(businesses.createdAt)).all();
    return c.json(rows);
  });

  app.post('/', validate('json', BusinessCreate), (c) => {
    const body = c.req.valid('json');
    const row = db
      .insert(businesses)
      .values({ ...body, id: generateId('b'), createdAt: Date.now() })
      .returning()
      .get();
    return c.json(row, 201);
  });

  app.get('/:id', (c) => {
    const row = db
      .select()
      .from(businesses)
      .where(eq(businesses.id, c.req.param('id')))
      .get();
    if (!row) return c.json({ error: 'not_found' }, 404);
    const businessTags = db.select().from(tags).where(eq(tags.businessId, row.id)).all();
    return c.json({ ...row, tags: businessTags });
  });

  app.patch('/:id', validate('json', BusinessUpdate), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const row =
      Object.keys(body).length > 0
        ? db.update(businesses).set(body).where(eq(businesses.id, id)).returning().get()
        : db.select().from(businesses).where(eq(businesses.id, id)).get();
    if (!row) return c.json({ error: 'not_found' }, 404);
    // El estado del negocio afecta a `active` en KV de todos sus chips.
    const sync = await syncBusinessTags(db, linkStore, id);
    return c.json({ ...row, sync });
  });

  app.delete('/:id', (c) => {
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
    return c.body(null, 204);
  });

  return app;
}
