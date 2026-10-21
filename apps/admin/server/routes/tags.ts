import { buildTagUrls, generateSlug } from '@nfc/shared';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import QRCode from 'qrcode';
import { businesses, tagCounter, tags, type Tag } from '../db/schema.js';
import type { AppDeps, AppEnv } from '../context.js';
import { getTagScanStats } from '../scans.js';
import { syncTags, toLinkRecord, unpublishTag } from '../sync.js';
import { QrQuery, TagCreate, TagListQuery, TagUpdate, validate } from '../validation.js';

const MAX_SLUG_ATTEMPTS = 5;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}

export function tagRoutes({ db, linkStore, scanStore, publicBaseUrl }: AppDeps) {
  const app = new Hono<AppEnv>();

  const present = (tag: Tag) => ({ ...tag, urls: buildTagUrls(publicBaseUrl, tag.slug) });

  const findTag = (slug: string) => db.select().from(tags).where(eq(tags.slug, slug)).get();

  const businessExists = (id: string) =>
    db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, id)).get() !==
    undefined;

  const isPublished = (tag: Tag) => {
    const business = tag.businessId
      ? (db.select().from(businesses).where(eq(businesses.id, tag.businessId)).get() ?? null)
      : null;
    return toLinkRecord(tag, business) !== null;
  };

  app.get('/', validate('query', TagListQuery), (c) => {
    const query = c.req.valid('query');
    const filters: SQL[] = [];
    if (query.businessId) filters.push(eq(tags.businessId, query.businessId));
    if (query.unassigned === 'true') filters.push(isNull(tags.businessId));
    const rows = db
      .select()
      .from(tags)
      .where(and(...filters))
      .orderBy(desc(tags.number))
      .all();
    return c.json(rows.map(present));
  });

  app.post('/', validate('json', TagCreate), async (c) => {
    const body = c.req.valid('json');
    if (body.businessId && !businessExists(body.businessId)) {
      return c.json({ error: 'business_not_found' }, 422);
    }

    let created: Tag | undefined;
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS && !created; attempt++) {
      try {
        // Número y chip en la misma transacción: si el slug choca, el contador no avanza.
        created = db.transaction((tx) => {
          const counter = tx
            .insert(tagCounter)
            .values({ id: 1, last: 1 })
            .onConflictDoUpdate({
              target: tagCounter.id,
              set: { last: sql`${tagCounter.last} + 1` },
            })
            .returning()
            .get();
          return tx
            .insert(tags)
            .values({
              ...body,
              slug: generateSlug(),
              number: counter.last,
              assignedAt: body.businessId ? Date.now() : null,
              createdAt: Date.now(),
            })
            .returning()
            .get();
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!created) return c.json({ error: 'slug_generation_failed' }, 500);

    const sync = await syncTags(db, linkStore, [created.slug]);
    const tag = findTag(created.slug) ?? created;
    return c.json({ ...present(tag), published: isPublished(tag), sync }, 201);
  });

  app.get('/number/:number{[0-9]+}', (c) => {
    const tag = db
      .select()
      .from(tags)
      .where(eq(tags.number, Number(c.req.param('number'))))
      .get();
    if (!tag) return c.json({ error: 'not_found' }, 404);
    return c.json({ ...present(tag), published: isPublished(tag) });
  });

  app.get('/:slug', (c) => {
    const tag = findTag(c.req.param('slug'));
    if (!tag) return c.json({ error: 'not_found' }, 404);
    return c.json({ ...present(tag), published: isPublished(tag) });
  });

  app.patch('/:slug', validate('json', TagUpdate), async (c) => {
    const slug = c.req.param('slug');
    const body = c.req.valid('json');
    const current = findTag(slug);
    if (!current) return c.json({ error: 'not_found' }, 404);
    if (body.businessId && !businessExists(body.businessId)) {
      return c.json({ error: 'business_not_found' }, 422);
    }
    // Al cambiar de negocio, las estadísticas empiezan de cero para el nuevo.
    const reassigned = body.businessId !== undefined && body.businessId !== current.businessId;
    const changes = reassigned
      ? { ...body, assignedAt: body.businessId ? Date.now() : null }
      : body;
    if (Object.keys(changes).length > 0) {
      db.update(tags).set(changes).where(eq(tags.slug, slug)).run();
    }
    const sync = await syncTags(db, linkStore, [slug]);
    const tag = findTag(slug);
    if (!tag) return c.json({ error: 'not_found' }, 404);
    return c.json({ ...present(tag), published: isPublished(tag), sync });
  });

  app.get('/:slug/scans', async (c) => {
    const tag = findTag(c.req.param('slug'));
    if (!tag) return c.json({ error: 'not_found' }, 404);
    if (!scanStore) {
      return c.json(
        {
          error: 'scans_unavailable',
          message: 'Las estadísticas no están configuradas (CF_D1_DATABASE_ID).',
        },
        503,
      );
    }
    try {
      return c.json(await getTagScanStats(scanStore, tag.slug, tag.assignedAt));
    } catch (err) {
      return c.json(
        {
          error: 'scans_failed',
          message: `No se pudieron leer los escaneos de Cloudflare: ${err instanceof Error ? err.message : String(err)}`,
        },
        502,
      );
    }
  });

  /** Marca el chip físico como bloqueado (tras escribirlo y hacer makeReadOnly). */
  app.post('/:slug/lock', (c) => {
    const slug = c.req.param('slug');
    const tag = findTag(slug);
    if (!tag) return c.json({ error: 'not_found' }, 404);
    if (tag.lockedAt) return c.json({ error: 'already_locked', lockedAt: tag.lockedAt }, 409);
    const updated = db
      .update(tags)
      .set({ lockedAt: Date.now() })
      .where(eq(tags.slug, slug))
      .returning()
      .get();
    return c.json(present(updated ?? tag));
  });

  app.delete('/:slug', async (c) => {
    const slug = c.req.param('slug');
    const tag = findTag(slug);
    if (!tag) return c.json({ error: 'not_found' }, 404);
    if (tag.lockedAt) {
      return c.json(
        {
          error: 'locked',
          message:
            'El chip físico ya está bloqueado con esta URL. Desactívalo o reasígnalo en lugar de borrarlo.',
        },
        409,
      );
    }
    db.delete(tags).where(eq(tags.slug, slug)).run();
    const sync = await unpublishTag(linkStore, slug);
    return c.json({ deleted: slug, sync });
  });

  app.get('/:slug/qr', validate('query', QrQuery), async (c) => {
    const slug = c.req.param('slug');
    const tag = findTag(slug);
    if (!tag) return c.json({ error: 'not_found' }, 404);
    const { format, size, margin, download } = c.req.valid('query');
    const { qr } = buildTagUrls(publicBaseUrl, slug);
    const options = { errorCorrectionLevel: 'M' as const, margin, width: size };
    const disposition = `${download === '1' ? 'attachment' : 'inline'}; filename="chip-${tag.number}-${slug}-qr.${format}"`;

    if (format === 'png') {
      const png = await QRCode.toBuffer(qr, { ...options, type: 'png' });
      return c.body(new Uint8Array(png), 200, {
        'content-type': 'image/png',
        'content-disposition': disposition,
      });
    }
    const svg = await QRCode.toString(qr, { ...options, type: 'svg' });
    return c.body(svg, 200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': disposition,
    });
  });

  return app;
}
