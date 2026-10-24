import { zValidator } from '@hono/zod-validator';
import {
  AccountId,
  BusinessId,
  CreateAccountBody,
  DeleteQuery,
  IncidentsQuery,
  PutBusinessBody,
  PutBusinessSettingsBody,
  PutTagBody,
  PutTagSettingsBody,
  ScanStatsQuery,
  SettingsChangesQuery,
  Slug,
  SyncBody,
} from '@nfc/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { addAccount, createLoginLink, listAccounts, removeAccount } from '../accounts/store.js';
import type { Env } from '../env.js';
import { incidentSummary } from '../rate-limit.js';
import { internalAuth } from './auth.js';
import {
  deleteBusiness,
  deleteTag,
  putBusiness,
  putBusinessSettings,
  putTag,
  putTagSettings,
  settingsChanges,
  syncAll,
  type SettingsError,
} from './control-plane.js';
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

const SETTINGS_STATUS = { not_found: 404, not_assigned: 409 } as const satisfies Record<
  SettingsError,
  number
>;
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

// Ajustes del negocio cambiados por el admin desde el panel (quedan en la auditoría).
internalRoutes.put(
  '/tags/:slug/settings',
  slugParam,
  json('json', PutTagSettingsBody),
  async (c) => {
    const result = await putTagSettings(c.env, c.req.valid('param').slug, c.req.valid('json'), {
      type: 'admin',
    });
    if (!result.ok) return c.json({ error: result.error }, SETTINGS_STATUS[result.error]);
    return c.json(result.settings);
  },
);

internalRoutes.put(
  '/businesses/:id/settings',
  businessParam,
  json('json', PutBusinessSettingsBody),
  async (c) => {
    const result = await putBusinessSettings(c.env, c.req.valid('param').id, c.req.valid('json'), {
      type: 'admin',
    });
    if (!result.ok) return c.json({ error: result.error }, SETTINGS_STATUS[result.error]);
    return c.json(result.settings);
  },
);

/** Para que la Pi refresque su copia de los ajustes (lo que cambian los dueños). */
internalRoutes.get('/settings', json('query', SettingsChangesQuery), async (c) => {
  return c.json(await settingsChanges(c.env.DB, c.req.valid('query').since));
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

// Cuentas de los dueños: las crea el admin; el enlace de acceso se copia desde el panel.
const accountParam = zValidator('param', z.object({ id: BusinessId, accountId: AccountId }));

internalRoutes.get('/businesses/:id/accounts', businessParam, async (c) => {
  return c.json({ accounts: await listAccounts(c.env.DB, c.req.valid('param').id) });
});

internalRoutes.post(
  '/businesses/:id/accounts',
  businessParam,
  json('json', CreateAccountBody),
  async (c) => {
    const result = await addAccount(c.env, c.req.valid('param').id, c.req.valid('json'), {
      type: 'admin',
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.error === 'already_member' ? 409 : 404);
    }
    return c.json(result.account, 201);
  },
);

internalRoutes.delete('/businesses/:id/accounts/:accountId', accountParam, async (c) => {
  const { id, accountId } = c.req.valid('param');
  const removed = await removeAccount(c.env, id, accountId, { type: 'admin' });
  return removed ? c.json({ removed: true }) : c.json({ error: 'not_found' }, 404);
});

internalRoutes.post('/businesses/:id/accounts/:accountId/login-link', accountParam, async (c) => {
  const { id, accountId } = c.req.valid('param');
  const link = await createLoginLink(c.env, id, accountId);
  return link ? c.json(link) : c.json({ error: 'not_found' }, 404);
});

/** Incidentes de límite de peticiones (de un negocio o de todos). */
internalRoutes.get('/incidents', json('query', IncidentsQuery), async (c) => {
  const { businessId, days } = c.req.valid('query');
  return c.json(await incidentSummary(c.env, businessId ?? null, days, Date.now()));
});

internalRoutes.onError((err, c) => {
  console.error('Error en /internal', String(err));
  return c.json({ error: 'internal_error' }, 500);
});
