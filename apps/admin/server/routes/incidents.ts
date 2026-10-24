import { Hono, type Context } from 'hono';
import type { RateLimitIncidentsDto } from '../contracts.js';
import type { AppEnv, RouteDeps } from '../context.js';

const DAYS = 30;

/** Incidentes de límite de peticiones (los registra el Worker en D1). */
export function incidentRoutes({ businesses, edge }: RouteDeps) {
  const app = new Hono<AppEnv>();

  async function respond(c: Context, businessId: string | null) {
    try {
      const { mode, incidents } = await edge.incidents(businessId, DAYS);
      const names = new Map(businesses.list().map((b) => [b.id, b.name]));
      const body: RateLimitIncidentsDto = {
        mode,
        days: DAYS,
        incidents: incidents.map((i) => ({
          ...i,
          businessId: i.businessId || null,
          businessName: names.get(i.businessId) ?? null,
        })),
      };
      return c.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: 'edge_failed', message: `No se pudo consultar Cloudflare: ${message}` },
        502,
      );
    }
  }

  app.get('/incidents', (c) => respond(c, null));

  app.get('/businesses/:id/incidents', (c) => {
    const business = businesses.find(c.req.param('id'));
    if (!business) return c.json({ error: 'not_found' }, 404);
    return respond(c, business.id);
  });

  return app;
}
