import { Hono } from 'hono';
import type { BusinessDetailDto } from '../contracts.js';
import type { AppEnv, RouteDeps } from '../context.js';
import type { Business } from '../db/schema.js';
import { toBusinessDto, toTagDto } from '../presenters.js';
import type { BusinessResult, DeleteBusinessResult } from '../services/business-service.js';
import { BusinessCreate, BusinessUpdate, validate } from '../validation.js';
import { EDGE_UNAVAILABLE, errorResponder } from './errors.js';

type BusinessError = Extract<BusinessResult | DeleteBusinessResult, { ok: false }>['error'];

const fail = errorResponder<BusinessError>({
  not_found: { status: 404 },
  edge_unavailable: EDGE_UNAVAILABLE,
  has_tags: {
    status: 409,
    message: 'El negocio tiene chips asignados. Libéralos o marca el negocio como cancelado.',
  },
});

export function businessRoutes({ businesses, publicBaseUrl }: RouteDeps) {
  const app = new Hono<AppEnv>();
  const dto = (business: Business) => toBusinessDto(business, publicBaseUrl);

  app.get('/', (c) => c.json(businesses.list().map(dto)));

  app.post('/', validate('json', BusinessCreate), async (c) => {
    const { business, sync } = await businesses.create(c.req.valid('json'));
    return c.json({ ...dto(business), sync }, 201);
  });

  app.get('/:id', (c) => {
    const found = businesses.get(c.req.param('id'));
    if (!found) return fail(c, 'not_found');
    const body: BusinessDetailDto = {
      ...dto(found.business),
      tags: found.tags.map(({ tag, published }) => toTagDto(tag, published, publicBaseUrl)),
    };
    return c.json(body);
  });

  app.patch('/:id', validate('json', BusinessUpdate), async (c) => {
    const result = await businesses.update(c.req.param('id'), c.req.valid('json'));
    if (!result.ok) {
      return fail(c, result.error, 'detail' in result ? { detail: result.detail } : {});
    }
    return c.json({ ...dto(result.business), sync: result.sync });
  });

  app.post('/:id/report-token', async (c) => {
    const result = await businesses.regenerateReportToken(c.req.param('id'));
    if (!result.ok) return fail(c, result.error);
    return c.json({ ...dto(result.business), sync: result.sync });
  });

  app.delete('/:id', async (c) => {
    const result = await businesses.delete(c.req.param('id'));
    if (!result.ok) return fail(c, result.error);
    if (!result.sync.ok) {
      console.error('No se pudo retirar el negocio de Cloudflare', result.sync.error);
    }
    return c.body(null, 204);
  });

  return app;
}
