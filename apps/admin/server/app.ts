import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
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
  /** Carpeta con el build de la UI (Vite). `null` = no servir UI (desarrollo con `vite dev`). */
  staticDir?: string | null;
}

export function createApp(options: CreateAppOptions) {
  const { auth, log = false, staticDir = null, ...deps } = options;
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

  if (staticDir) {
    // Los assets llevan hash en el nombre: se pueden cachear para siempre.
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.status === 200) {
        c.res.headers.set('cache-control', 'public, max-age=31536000, immutable');
      }
    });
    app.use('*', serveStatic({ root: staticDir }));
    // Fallback de SPA: cualquier GET que no sea API ni archivo devuelve index.html.
    const indexHtml = readFileSync(join(staticDir, 'index.html'), 'utf8');
    app.get('*', (c, next) => {
      if (c.req.path.startsWith('/api/')) return next();
      c.header('cache-control', 'no-cache');
      return c.html(indexHtml);
    });
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
