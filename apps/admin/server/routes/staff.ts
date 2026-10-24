import { AppSettingsBody, CreatePairingBody, StaffDeviceId } from '@nfc/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv, RouteDeps } from '../context.js';
import { EdgeError } from '../edge-client.js';
import { validate } from '../validation.js';

function edgeFailed(c: Context, err: unknown) {
  if (err instanceof EdgeError && err.status === 404) {
    return c.json(
      {
        error: 'not_published',
        message:
          'Cloudflare aún no tiene este negocio (o ese móvil). Revisa los cambios pendientes o pulsa "Re-sincronizar todo".',
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

/** Móviles del personal de un negocio (viven en D1). */
export function staffRoutes({ businesses, edge }: RouteDeps) {
  const app = new Hono<AppEnv>();

  // `/*` también cubre `/:id/staff` sin nada detrás.
  app.use('/:id/staff/*', async (c, next) => {
    if (!businesses.find(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
    await next();
  });

  app.get('/:id/staff', async (c) => {
    try {
      return c.json(await edge.staffDevices(c.req.param('id')));
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  app.post('/:id/staff/pairing', validate('json', CreatePairingBody), async (c) => {
    try {
      return c.json(await edge.createPairing(c.req.param('id'), c.req.valid('json').label));
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  app.delete('/:id/staff/:deviceId', async (c) => {
    const deviceId = StaffDeviceId.safeParse(c.req.param('deviceId'));
    if (!deviceId.success) return c.json({ error: 'not_found' }, 404);
    try {
      await edge.revokeStaffDevice(c.req.param('id'), deviceId.data);
      return c.json({ revoked: true });
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  return app;
}

/** Ajustes globales del admin (viven en D1). */
export function appSettingsRoutes({ edge }: RouteDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    try {
      return c.json(await edge.appSettings());
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  app.put('/', validate('json', AppSettingsBody), async (c) => {
    try {
      return c.json(await edge.setAppSettings(c.req.valid('json')));
    } catch (err) {
      return edgeFailed(c, err);
    }
  });

  return app;
}
