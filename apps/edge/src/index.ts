import { Hono } from 'hono';
import {
  businessKey,
  BusinessRecord,
  isValidSlug,
  LinkRecord,
  sourceFromParam,
  SOURCE_PARAM,
} from '@nfc/shared';
import { cleanupLoginTokens, portalOrigin } from './accounts/store.js';
import { cleanupAudit } from './audit.js';
import type { Env } from './env.js';
import { fallbackResponse as fallback } from './fallback.js';
import { internalRoutes } from './internal/routes.js';
import { handleLoyaltyTap, loyaltyRoutes } from './loyalty/routes.js';
import { loyaltySummary } from './loyalty/store.js';
import { portalRoutes } from './portal/routes.js';
import { cleanupSessions } from './portal/session.js';
import { cleanupPairingTokens } from './staff/store.js';
import { cleanupRateLimits } from './rate-limit.js';
import { loadReport, queryReportStats } from './report.js';
import { renderReportPage, type ReportLoyalty } from './report-page.js';
import { buildScanEvent, recordScan } from './scan.js';

const app = new Hono<{ Bindings: Env }>();

// Las respuestas no se cachean: el destino puede cambiar y cada escaneo debe llegar al Worker.
const NO_STORE = 'no-store';

async function readLink(kv: KVNamespace, slug: string): Promise<LinkRecord | null> {
  const raw = await kv.get(slug, 'json');
  if (raw === null) return null;
  const parsed = LinkRecord.safeParse(raw);
  if (!parsed.success) {
    console.error('Registro KV inválido', { slug, issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}

app.get('/health', (c) => c.text('ok', 200, { 'cache-control': NO_STORE }));

/** Enlace privado de estadísticas de un negocio: go.penginexr.com/r/<token>. */
app.get('/r/:token', async (c) => {
  const report = await loadReport(c.env.LINKS, c.req.param('token'));
  if (!report) return fallback();
  const now = Date.now();
  const offset = Number(c.env.REPORT_TZ_OFFSET_MINUTES ?? '-300');
  const [stats, businessRaw] = await Promise.all([
    queryReportStats(c.env.DB, report, now, offset),
    c.env.LINKS.get(businessKey(report.businessId), 'json'),
  ]);
  const business = BusinessRecord.safeParse(businessRaw);
  let loyalty: ReportLoyalty | null = null;
  if (business.success && business.data.loyaltyVisits !== null) {
    loyalty = {
      visits: business.data.loyaltyVisits,
      summary: await loyaltySummary(c.env.DB, report.businessId, now),
    };
  }
  return new Response(renderReportPage(report, stats, now, loyalty), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': NO_STORE,
      'x-robots-tag': 'noindex, nofollow',
      // El token va en la URL: que no se filtre por Referer ni se pueda incrustar la página.
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
});

// API interna para la Pi (plano de control). Sin token válido responde 404.
app.route('/internal', internalRoutes);

// Fidelidad: alta, tarjeta, canje, validación y baja (rutas de varios segmentos).
app.route('/', loyaltyRoutes);

app.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!isValidSlug(slug)) return fallback();

  let link: LinkRecord | null;
  try {
    link = await readLink(c.env.LINKS, slug);
  } catch (err) {
    console.error('Error leyendo KV', { slug, err: String(err) });
    return fallback(503);
  }

  // Solo se registran chips publicados (también inactivos): las rutas que prueban los
  // escáneres de internet (/server, /version…) no deben llenar D1. No bloquea la respuesta.
  if (link) {
    const event = buildScanEvent(c.req.raw, slug);
    c.executionCtx.waitUntil(
      recordScan(c.env.DB, event).catch((err: unknown) => {
        console.error('No se pudo registrar el escaneo', { slug, err: String(err) });
      }),
    );
  }

  if (!link || !link.active) return fallback();

  if (link.type === 'redirect') {
    return new Response(null, {
      status: 302,
      headers: { location: link.url, 'cache-control': NO_STORE },
    });
  }

  if (link.type === 'loyalty') {
    const source = sourceFromParam(new URL(c.req.url).searchParams.get(SOURCE_PARAM));
    return handleLoyaltyTap(c, link, slug, source);
  }

  // Las landings se renderizan en la Fase 3; mientras tanto, página genérica.
  return fallback();
});

app.notFound(() => fallback());

app.onError((err) => {
  console.error('Error no controlado', String(err));
  return fallback(503);
});

/** negocios.penginexr.com → portal; cualquier otro host (go.penginexr.com) → chips y API. */
function isPortalHost(request: Request, env: Env): boolean {
  return new URL(request.url).host === new URL(portalOrigin(env)).host;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return isPortalHost(request, env)
      ? portalRoutes.fetch(request, env, ctx)
      : app.fetch(request, env, ctx);
  },
  /** Cron diario (wrangler.toml): incidentes viejos, sales de días pasados y auditoría de >1 año. */
  async scheduled(_controller, env, ctx) {
    const now = Date.now();
    ctx.waitUntil(
      Promise.all([
        cleanupRateLimits(env.DB, now),
        cleanupAudit(env.DB, now),
        cleanupLoginTokens(env.DB, now),
        cleanupSessions(env.DB, now),
        cleanupPairingTokens(env.DB, now),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
