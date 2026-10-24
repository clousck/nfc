import { AccountId, CreateAccountBody } from '@nfc/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv, RouteDeps } from '../context.js';
import { EdgeError } from '../edge-client.js';
import { validate } from '../validation.js';

/** Errores del Worker traducidos a mensajes para el panel. */
function edgeFailed(c: Context, err: unknown) {
  if (err instanceof EdgeError && err.status === 409) {
    return c.json(
      { error: 'already_member', message: 'Ese correo ya tiene acceso a este negocio.' },
      409,
    );
  }
  if (err instanceof EdgeError && err.status === 404) {
    return c.json(
      {
        error: 'not_published',
        message:
          'Cloudflare aún no tiene este negocio (o esa cuenta). Revisa los cambios pendientes o pulsa "Re-sincronizar todo".',
      },
      409,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json(
    { error: 'edge_failed', message: `No se pudo contactar con Cloudflare: ${message}` },
    502,
  );
}

/**
 * Cuentas de los dueños (viven en D1). El panel las crea y copia el enlace de acceso para
 * enviarlo por WhatsApp; el dueño también puede pedirlo por correo desde el portal.
 */
export function accountRoutes({ businesses, edge }: RouteDeps) {
  const app = new Hono<AppEnv>();

  // `/*` también cubre `/:id/accounts` sin nada detrás.
  app.use('/:id/accounts/*', async (c, next) => {
    if (!businesses.find(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
    await next();
  });

  app.get('/:id/accounts', async (c) => {
    try {
      return c.json(await edge.accounts(c.req.param('id')));
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  app.post('/:id/accounts', validate('json', CreateAccountBody), async (c) => {
    try {
      return c.json(await edge.addAccount(c.req.param('id'), c.req.valid('json')), 201);
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  app.delete('/:id/accounts/:accountId', async (c) => {
    const accountId = AccountId.safeParse(c.req.param('accountId'));
    if (!accountId.success) return c.json({ error: 'not_found' }, 404);
    try {
      await edge.removeAccount(c.req.param('id'), accountId.data);
      return c.json({ removed: true });
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  app.post('/:id/accounts/:accountId/login-link', async (c) => {
    const accountId = AccountId.safeParse(c.req.param('accountId'));
    if (!accountId.success) return c.json({ error: 'not_found' }, 404);
    try {
      return c.json(await edge.loginLink(c.req.param('id'), accountId.data));
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  return app;
}
