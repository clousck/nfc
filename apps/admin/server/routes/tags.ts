import { buildTagUrls } from '@nfc/shared';
import { Hono } from 'hono';
import QRCode from 'qrcode';
import type { AppEnv, RouteDeps } from '../context.js';
import { toTagDto } from '../presenters.js';
import { getTagScanStats } from '../scans.js';
import type {
  CreateTagResult,
  DeleteTagResult,
  LockTagResult,
  QrTargetResult,
  TagWithStatus,
  UpdateTagResult,
} from '../services/tag-service.js';
import { QrQuery, TagCreate, TagListQuery, TagUpdate, validate } from '../validation.js';
import { errorResponder } from './errors.js';

type TagError = Extract<
  CreateTagResult | UpdateTagResult | LockTagResult | DeleteTagResult | QrTargetResult,
  { ok: false }
>['error'];

const fail = errorResponder<TagError>({
  not_found: { status: 404 },
  business_not_found: { status: 422 },
  slug_generation_failed: { status: 500 },
  already_locked: { status: 409 },
  locked: {
    status: 409,
    message:
      'El chip físico ya está bloqueado con esta URL. Desactívalo o reasígnalo en lugar de borrarlo.',
  },
  loyalty_no_qr: {
    status: 409,
    message:
      'Los chips de fidelidad no tienen QR: con la URL del QR se podrían sumar sellos sin ir al local.',
  },
});

export function tagRoutes({ tags, scanStore, publicBaseUrl }: RouteDeps) {
  const app = new Hono<AppEnv>();
  const dto = ({ tag, published }: TagWithStatus) => toTagDto(tag, published, publicBaseUrl);

  app.get('/', validate('query', TagListQuery), (c) => {
    const query = c.req.valid('query');
    const rows = tags.list({
      businessId: query.businessId,
      unassigned: query.unassigned === 'true',
    });
    return c.json(rows.map(dto));
  });

  app.post('/', validate('json', TagCreate), async (c) => {
    const result = await tags.create(c.req.valid('json'));
    if (!result.ok) return fail(c, result.error);
    return c.json({ ...dto(result), sync: result.sync }, 201);
  });

  app.get('/number/:number{[0-9]+}', (c) => {
    const found = tags.getByNumber(Number(c.req.param('number')));
    return found ? c.json(dto(found)) : fail(c, 'not_found');
  });

  app.get('/:slug', (c) => {
    const found = tags.get(c.req.param('slug'));
    return found ? c.json(dto(found)) : fail(c, 'not_found');
  });

  app.patch('/:slug', validate('json', TagUpdate), async (c) => {
    const result = await tags.update(c.req.param('slug'), c.req.valid('json'));
    if (!result.ok) return fail(c, result.error);
    return c.json({ ...dto(result), sync: result.sync });
  });

  app.get('/:slug/scans', async (c) => {
    const found = tags.get(c.req.param('slug'));
    if (!found) return fail(c, 'not_found');
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
      return c.json(await getTagScanStats(scanStore, found.tag.slug, found.tag.assignedAt));
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

  app.post('/:slug/lock', (c) => {
    const result = tags.lock(c.req.param('slug'));
    if (!result.ok) {
      return result.error === 'already_locked'
        ? fail(c, result.error, { lockedAt: result.lockedAt })
        : fail(c, result.error);
    }
    return c.json(dto(result));
  });

  app.delete('/:slug', async (c) => {
    const slug = c.req.param('slug');
    const result = await tags.delete(slug);
    if (!result.ok) return fail(c, result.error);
    return c.json({ deleted: slug, sync: result.sync });
  });

  app.get('/:slug/qr', validate('query', QrQuery), async (c) => {
    const result = tags.qrTarget(c.req.param('slug'));
    if (!result.ok) return fail(c, result.error);
    const { tag } = result;
    const { format, size, margin, download } = c.req.valid('query');
    const { qr } = buildTagUrls(publicBaseUrl, tag.slug);
    const options = { errorCorrectionLevel: 'M' as const, margin, width: size };
    const disposition = `${download === '1' ? 'attachment' : 'inline'}; filename="chip-${tag.number}-${tag.slug}-qr.${format}"`;

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
