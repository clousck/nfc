import { zValidator } from '@hono/zod-validator';
import {
  BusinessId,
  DeleteQuery,
  PutBusinessBody,
  PutTagBody,
  ScanStatsQuery,
  Slug,
  SyncBody,
} from '@nfc/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env.js';
import { internalAuth } from './auth.js';
import { deleteBusiness, deleteTag, putBusiness, putTag, syncAll } from './control-plane.js';
import { deleteCardOfBusiness, loyaltyCards, loyaltyContacts, tagScanStats } from './queries.js';

/** Errores de validación en JSON (esta API solo la consume la Pi). */
function json<Target extends 'json' | 'query', Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'validation', issues: z.treeifyError(result.error) }, 400);
    }
  });
}

const slugParam = zValidator('param', z.object({ slug: Slug }));
const businessParam = zValidator('param', z.object({ id: BusinessId }));

export const internalRoutes = new Hono<{ Bindings: Env }>();

internalRoutes.use('*', internalAuth);

internalRoutes.put('/tags/:slug', slugParam, json('json', PutTagBody), async (c) => {
  const { revision, ...tag } = c.req.valid('json');
  if (tag.slug !== c.req.valid('param').slug) return c.json({ error: 'slug_mismatch' }, 400);
  return c.json(await putTag(c.env, tag, revision));
});

internalRoutes.delete('/tags/:slug', slugParam, json('query', DeleteQuery), async (c) => {
  const { slug } = c.req.valid('param');
  return c.json(await deleteTag(c.env, slug, c.req.valid('query').revision));
});

internalRoutes.put('/businesses/:id', businessParam, json('json', PutBusinessBody), async (c) => {
  const { revision, ...business } = c.req.valid('json');
  if (business.id !== c.req.valid('param').id) return c.json({ error: 'id_mismatch' }, 400);
  return c.json(await putBusiness(c.env, business, revision));
});

internalRoutes.delete('/businesses/:id', businessParam, json('query', DeleteQuery), async (c) => {
  const { id } = c.req.valid('param');
  return c.json(await deleteBusiness(c.env, id, c.req.valid('query').revision));
});

internalRoutes.post('/sync', json('json', SyncBody), async (c) => {
  return c.json(await syncAll(c.env, c.req.valid('json')));
});

internalRoutes.get('/tags/:slug/scans', slugParam, json('query', ScanStatsQuery), async (c) => {
  const { since, recent } = c.req.valid('query');
  return c.json(await tagScanStats(c.env.DB, c.req.valid('param').slug, since ?? null, recent));
});

internalRoutes.get('/businesses/:id/loyalty/cards', businessParam, async (c) => {
  return c.json(await loyaltyCards(c.env.DB, c.req.valid('param').id, Date.now()));
});

internalRoutes.get('/businesses/:id/loyalty/contacts', businessParam, async (c) => {
  return c.json(await loyaltyContacts(c.env.DB, c.req.valid('param').id));
});

internalRoutes.delete(
  '/businesses/:id/loyalty/cards/:cardId',
  zValidator('param', z.object({ id: BusinessId, cardId: z.coerce.number().int().positive() })),
  async (c) => {
    const { id, cardId } = c.req.valid('param');
    return c.json({ deleted: await deleteCardOfBusiness(c.env.DB, id, cardId) });
  },
);

internalRoutes.onError((err, c) => {
  console.error('Error en /internal', String(err));
  return c.json({ error: 'internal_error' }, 500);
});
