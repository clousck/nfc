import { Hono, type MiddlewareHandler } from 'hono';
import { logger } from 'hono/logger';
import type { AppDeps, AppEnv } from './context.js';
import { businessRoutes } from './routes/businesses.js';
import { tagRoutes } from './routes/tags.js';
import { resyncAll } from './sync.js';

export interface CreateAppOptions extends AppDeps {
  /** Middleware de autenticación para `/api/*`; `null` la desactiva (solo desarrollo). */
  auth: MiddlewareHandler<AppEnv> | null;
  log?: boolean;
}

export function createApp(options: CreateAppOptions) {
  const { auth, log = false, ...deps } = options;
  const app = new Hono<AppEnv>();

  if (log) app.use(logger());

  app.get('/health', (c) => c.text('ok'));

  if (auth) app.use('/api/*', auth);

  app.route('/api/businesses', businessRoutes(deps));
  app.route('/api/tags', tagRoutes(deps));

  app.post('/api/sync', async (c) => {
    try {
      const result = await resyncAll(deps.db, deps.linkStore);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
