import {
  LoyaltyVisits,
  MAX_STAFF_DEVICES,
  StaffLabel,
  TargetUrl,
  type ReportRecord,
} from '@nfc/shared';
import { Hono } from 'hono';
import { adminNotifyEmail } from '../app-settings.js';
import { auditStatement, listAudit } from '../audit.js';
import type { Env } from '../env.js';
import { esc, pageHeaders, STRICT_CSP } from '../html.js';
import {
  businessState,
  businessTags,
  putBusinessSettings,
  putTagSettings,
} from '../internal/control-plane.js';
import { loyaltyContacts } from '../internal/queries.js';
import { loyaltySummary } from '../loyalty/store.js';
import { queryReportStats } from '../report.js';
import { renderReportPage } from '../report-page.js';
import { createPairing, listStaffDevices, revokeStaffDevice } from '../staff/store.js';
import {
  activityPage,
  businessPage,
  isFlashCode,
  pairingPage,
  staffPage,
  type FlashCode,
} from './business-pages.js';
import { mailSender } from './mail.js';
import { messagePage } from './pages.js';
import type { PortalBusiness, PortalSession } from './session.js';

// Lo que el dueño hace con su negocio. Todo pasa por la sesión: un negocio que no es suyo
// responde igual que uno inexistente (no se confirma que exista).

type BusinessEnv = {
  Bindings: Env;
  Variables: { session: PortalSession; business: PortalBusiness };
};

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: pageHeaders(STRICT_CSP) });

const back = (businessId: string, code: FlashCode, page = '') =>
  new Response(null, {
    status: 303,
    headers: { location: `/n/${businessId}${page}?m=${code}`, 'cache-control': 'no-store' },
  });

const hasLoyalty = async (env: Env, id: string) =>
  ((await businessState(env.DB, id))?.loyaltyVisits ?? null) !== null;

/** Campo CSV seguro: comillas escapadas y sin fórmulas (=, +, -, @) que Excel ejecutaría. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** BOM (U+FEFF) para que Excel abra bien las tildes. */
const BOM = String.fromCharCode(0xfeff);

const offset = (env: Env) => Number(env.REPORT_TZ_OFFSET_MINUTES ?? '-300');

export const businessRoutes = new Hono<BusinessEnv>();

businessRoutes.use('*', async (c, next) => {
  const session = c.get('session');
  const business = session.businesses.find((b) => b.id === c.req.param('businessId'));
  if (!business) {
    return html(messagePage('Página no encontrada', 'Este negocio no existe.', session), 404);
  }
  c.set('business', business);
  await next();
});

businessRoutes.get('/', async (c) => {
  const business = c.get('business');
  const [tags, state] = await Promise.all([
    businessTags(c.env.DB, business.id),
    businessState(c.env.DB, business.id),
  ]);
  const visits = state?.loyaltyVisits ?? null;
  const m = c.req.query('m');
  return html(
    businessPage({
      session: c.get('session'),
      business,
      tags,
      loyaltyVisits: visits,
      loyalty: visits === null ? null : await loyaltySummary(c.env.DB, business.id, Date.now()),
      flash: isFlashCode(m) ? m : null,
    }),
  );
});

businessRoutes.post('/chips/:slug', async (c) => {
  const business = c.get('business');
  const form = await c.req.formData();
  const label = String(form.get('etiqueta') ?? '')
    .replace(/[\p{C}<>]/gu, '')
    .trim()
    .slice(0, 80);
  const patch: { label: string | null; targetUrl?: string | null } = { label: label || null };
  if (form.has('destino')) {
    const raw = String(form.get('destino') ?? '').trim();
    if (raw === '') {
      patch.targetUrl = null;
    } else {
      const url = TargetUrl.safeParse(raw);
      if (!url.success) return back(business.id, 'url_invalida');
      patch.targetUrl = url.data;
    }
  }
  // Un chip de redirección sin destino dejaría de funcionar: no se permite desde el portal.
  const tag = (await businessTags(c.env.DB, business.id)).find(
    (t) => t.slug === c.req.param('slug'),
  );
  if (tag?.type === 'redirect' && patch.targetUrl === null) {
    return back(business.id, 'falta_destino');
  }
  const result = await putTagSettings(
    c.env,
    c.req.param('slug'),
    patch,
    { type: 'owner', id: c.get('session').accountId },
    Date.now(),
    business.id,
  );
  if (!result.ok) {
    return html(messagePage('Chip no encontrado', 'Este chip no es de tu negocio.'), 404);
  }
  return back(business.id, result.publish.applied ? 'guardado' : 'sin_cambios');
});

/** "Stand perdido o dañado": pausa el chip (no lo libera) y avisa al admin. */
businessRoutes.post('/chips/:slug/pausa', async (c) => {
  const business = c.get('business');
  const session = c.get('session');
  const form = await c.req.formData();
  const pause = form.get('accion') === 'pausar';
  const now = Date.now();
  const result = await putTagSettings(
    c.env,
    c.req.param('slug'),
    { paused: pause },
    { type: 'owner', id: session.accountId },
    now,
    business.id,
  );
  if (!result.ok) {
    return html(messagePage('Chip no encontrado', 'Este chip no es de tu negocio.'), 404);
  }
  if (pause && result.publish.applied) {
    c.executionCtx.waitUntil(
      notifyLostStand(c.env, business, result.settings.slug, session.email, now).catch(
        (err: unknown) => console.error('No se pudo avisar del stand perdido', String(err)),
      ),
    );
  }
  return back(business.id, pause ? 'pausado' : 'reactivado');
});

async function notifyLostStand(
  env: Env,
  business: PortalBusiness,
  slug: string,
  by: string,
  now: number,
): Promise<void> {
  const to = await adminNotifyEmail(env);
  if (!to) {
    console.warn('Stand perdido sin correo de aviso', { business: business.id, slug });
    return;
  }
  const tag = (await businessTags(env.DB, business.id)).find((t) => t.slug === slug);
  const chip = tag ? `#${tag.number}${tag.label ? ` (${tag.label})` : ''}` : slug;
  const when = new Date(now).toISOString();
  const text = `${business.name} marcó el chip ${chip} como stand perdido o dañado.\n\nMarcado por: ${by}\nFecha: ${when}\n\nEl chip quedó pausado (no liberado). Visita el local o repón el stand; puedes reactivarlo desde el panel.`;
  await mailSender(env).send({
    to,
    subject: `Stand perdido: ${business.name} · chip ${chip}`,
    text,
    html: `<p>${esc(text).replace(/\n/g, '<br>')}</p>`,
  });
}

businessRoutes.post('/premio', async (c) => {
  const business = c.get('business');
  const form = await c.req.formData();
  const visits = LoyaltyVisits.safeParse(Number(form.get('visitas')));
  if (!visits.success) return back(business.id, 'visitas_invalidas');
  // Activar o desactivar el programa es una decisión comercial (plan): solo el admin.
  const state = await businessState(c.env.DB, business.id);
  if (state?.loyaltyVisits === null || state?.loyaltyVisits === undefined) {
    return back(business.id, 'premio_inactivo');
  }
  const result = await putBusinessSettings(
    c.env,
    business.id,
    { loyaltyVisits: visits.data },
    { type: 'owner', id: c.get('session').accountId },
  );
  if (!result.ok) return back(business.id, 'premio_inactivo');
  return back(business.id, result.publish.applied ? 'premio' : 'sin_cambios');
});

businessRoutes.get('/estadisticas', async (c) => {
  const business = c.get('business');
  const now = Date.now();
  const tags = await businessTags(c.env.DB, business.id);
  const report: ReportRecord = {
    businessId: business.id,
    name: business.name,
    tags: tags.map((t) => ({
      slug: t.slug,
      number: t.number,
      label: t.label,
      since: t.assignedAt,
    })),
  };
  const [stats, state] = await Promise.all([
    queryReportStats(c.env.DB, report, now, offset(c.env)),
    businessState(c.env.DB, business.id),
  ]);
  const visits = state?.loyaltyVisits ?? null;
  const loyalty =
    visits === null ? null : { visits, summary: await loyaltySummary(c.env.DB, business.id, now) };
  return html(renderReportPage(report, stats, now, loyalty, { backUrl: `/n/${business.id}` }));
});

/** Contactos que aceptaron promociones. La descarga queda en la auditoría (datos personales). */
businessRoutes.get('/contactos.csv', async (c) => {
  const business = c.get('business');
  const now = Date.now();
  const { contacts } = await loyaltyContacts(c.env.DB, business.id);
  await auditStatement(c.env.DB, {
    businessId: business.id,
    actor: { type: 'owner', id: c.get('session').accountId },
    action: 'contacts.exported',
    target: business.id,
    before: null,
    after: { count: contacts.length },
    ts: now,
  }).run();
  const lines = [
    ['Nombre', 'Teléfono', 'Aceptó promociones el'].map(csvField).join(','),
    ...contacts.map((r) =>
      [r.name, r.phone, new Date(r.marketingAt).toISOString().slice(0, 10)].map(csvField).join(','),
    ),
  ];
  const filename = `contactos-${business.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;

  return new Response(`${BOM}${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contactos.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  });
});

businessRoutes.get('/actividad', async (c) => {
  const business = c.get('business');
  const [entries, state] = await Promise.all([
    listAudit(c.env.DB, business.id),
    businessState(c.env.DB, business.id),
  ]);
  return html(
    activityPage({
      session: c.get('session'),
      business,
      entries,
      loyalty: (state?.loyaltyVisits ?? null) !== null,
    }),
  );
});

// ---------- Personal: móviles que validan canjes ----------

businessRoutes.get('/personal', async (c) => {
  const business = c.get('business');
  const [devices, loyalty] = await Promise.all([
    listStaffDevices(c.env.DB, business.id),
    hasLoyalty(c.env, business.id),
  ]);
  const m = c.req.query('m');
  return html(
    staffPage({
      session: c.get('session'),
      business,
      devices,
      loyalty,
      flash: isFlashCode(m) ? m : null,
    }),
  );
});

/** Crea el enlace de vinculación y lo muestra una sola vez (no se puede volver a ver). */
businessRoutes.post('/personal', async (c) => {
  const business = c.get('business');
  const form = await c.req.formData();
  const label = StaffLabel.safeParse(String(form.get('nombre') ?? ''));
  if (!label.success || label.data === '') {
    return back(business.id, 'nombre_invalido', '/personal');
  }
  const devices = await listStaffDevices(c.env.DB, business.id);
  if (devices.length >= MAX_STAFF_DEVICES) {
    return back(business.id, 'demasiados_moviles', '/personal');
  }
  const session = c.get('session');
  const pairing = await createPairing(c.env, business.id, label.data, {
    type: 'owner',
    id: session.accountId,
  });
  return html(
    pairingPage({
      session,
      business,
      label: label.data,
      pairing,
      loyalty: await hasLoyalty(c.env, business.id),
    }),
  );
});

businessRoutes.post('/personal/:deviceId/revocar', async (c) => {
  const business = c.get('business');
  await revokeStaffDevice(c.env, business.id, c.req.param('deviceId'), {
    type: 'owner',
    id: c.get('session').accountId,
  });
  return back(business.id, 'vinculado_revocado', '/personal');
});
