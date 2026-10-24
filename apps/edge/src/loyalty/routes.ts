import {
  BusinessRecord,
  businessKey,
  LinkRecord,
  normalizePhone,
  parseRedemptionCode,
  REDEMPTION_CODE_PATTERN,
  reportKey,
  ReportRecord,
  REPORT_TOKEN_PATTERN,
} from '@nfc/shared';
import { Hono, type Context } from 'hono';
import type { Env } from '../env.js';
import { pageHeaders, STRICT_CSP } from '../html.js';
import { allowRequest, clientIp } from '../rate-limit.js';
import {
  cardPage,
  colorOfDay,
  deleteConfirmPage,
  messagePage,
  privacyPage,
  redeemConfirmPage,
  redemptionPage,
  signupPage,
  validationPage,
  type CardMessage,
  type ValidationOutcome,
} from './pages.js';
import {
  cookieHeader,
  DEVICE_COOKIE,
  hashToken,
  isSameOrigin,
  newDeviceToken,
  readCookie,
  readDeviceToken,
  STAFF_COOKIE,
} from './security.js';
import {
  addStamp,
  createCard,
  deleteCard,
  effectiveStamps,
  findCard,
  findPendingRedemption,
  findRedemption,
  localDay,
  redeem,
  validateRedemption,
} from './store.js';

type AppContext = Context<{ Bindings: Env }>;
type LoyaltyLink = Extract<LinkRecord, { type: 'loyalty' }>;

const DAY_MS = 86_400_000;

function offset(env: Env): number {
  return Number(env.REPORT_TZ_OFFSET_MINUTES ?? '-300');
}

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...pageHeaders(STRICT_CSP), ...extra } });
}

function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store', ...extra },
  });
}

async function loadBusiness(kv: KVNamespace, businessId: string): Promise<BusinessRecord | null> {
  const raw = await kv.get(businessKey(businessId), 'json');
  const parsed = BusinessRecord.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function loadLoyaltyLink(kv: KVNamespace, slug: string): Promise<LoyaltyLink | null> {
  const parsed = LinkRecord.safeParse(await kv.get(slug, 'json'));
  return parsed.success && parsed.data.type === 'loyalty' && parsed.data.active
    ? parsed.data
    : null;
}

/** Tarjeta del navegador actual en ese negocio (si tiene). */
async function currentCard(c: AppContext, businessId: string) {
  const token = readDeviceToken(c.req.raw);
  if (!token) return null;
  return findCard(c.env.DB, businessId, await hashToken(token));
}

/** Límite de peticiones superado (solo en modo `enforce`). */
function tooMany(): Response {
  return html(messagePage('Demasiados intentos', 'Espera un minuto y vuelve a intentarlo.'), 429, {
    'retry-after': '60',
  });
}

function notAvailable(): Response {
  return html(
    messagePage(
      'Tarjeta no disponible',
      'Este programa de fidelidad no está activo en este momento.',
    ),
    404,
  );
}

/**
 * Acercar el móvil a un chip de fidelidad: alta si es la primera vez; si no, sello del día.
 * Los escaneos por QR (?s=q) muestran la tarjeta pero nunca suman sellos.
 */
export async function handleLoyaltyTap(
  c: AppContext,
  link: LoyaltyLink,
  slug: string,
  source: 'nfc' | 'qr',
): Promise<Response> {
  const business = await loadBusiness(c.env.LINKS, link.businessId);
  if (!business) return notAvailable();
  // Programa desactivado: el chip se comporta como uno directo.
  if (business.loyaltyVisits === null) {
    return link.url ? redirect(link.url) : notAvailable();
  }
  const visits = business.loyaltyVisits;
  const card = await currentCard(c, link.businessId);
  if (!card) {
    return html(
      signupPage({
        businessId: link.businessId,
        businessName: business.name,
        visits,
        slug,
        source,
      }),
    );
  }

  const now = Date.now();
  let message: CardMessage = 'view';
  let shown = card;
  if (source === 'nfc') {
    const stamped = await addStamp(c.env.DB, card, {
      slug,
      visitsRequired: visits,
      now,
      offsetMinutes: offset(c.env),
    });
    message = stamped.result === 'added' ? 'added' : stamped.result;
    shown = stamped.card;
  }
  const pending = await findPendingRedemption(c.env.DB, card.id, now - DAY_MS);
  return html(
    cardPage({
      businessId: link.businessId,
      businessName: business.name,
      customerName: shown.name,
      visits,
      stamps: effectiveStamps(shown, now),
      message,
      continueUrl: link.url,
      pendingCode: pending?.code ?? null,
    }),
    200,
    // Renueva la cookie en cada visita (máximo 400 días).
    { 'set-cookie': cookieHeader(DEVICE_COOKIE, readDeviceToken(c.req.raw)!) },
  );
}

export const loyaltyRoutes = new Hono<{ Bindings: Env }>();

// Los formularios solo se aceptan desde nuestras propias páginas.
loyaltyRoutes.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !isSameOrigin(c.req.raw)) {
    return html(messagePage('Solicitud no válida', 'Vuelve a intentarlo desde la tarjeta.'), 403);
  }
  await next();
});

loyaltyRoutes.post('/l/:slug/registro', async (c) => {
  const slug = c.req.param('slug');
  const link = await loadLoyaltyLink(c.env.LINKS, slug);
  const business = link ? await loadBusiness(c.env.LINKS, link.businessId) : null;
  if (!link || !business?.loyaltyVisits) return notAvailable();

  const form = await c.req.formData();
  const name = String(form.get('nombre') ?? '')
    .replace(/[\p{C}<>]/gu, '')
    .trim()
    .slice(0, 60);
  const phoneInput = String(form.get('telefono') ?? '');
  const source = form.get('fuente') === 'qr' ? 'qr' : 'nfc';
  const values = { name, phone: phoneInput };
  const retry = (error: string) =>
    html(
      signupPage({
        businessId: link.businessId,
        businessName: business.name,
        visits: business.loyaltyVisits!,
        slug,
        source,
        error,
        values,
      }),
      400,
    );

  if (name.length < 2) return retry('Escribe tu nombre.');
  const phone = normalizePhone(phoneInput);
  if (!phone) return retry('Ese teléfono no parece válido. Ejemplo: 099 123 4567.');
  if (form.get('acepto') !== 'on') {
    return retry('Para crear la tarjeta tienes que aceptar que guardemos tus datos.');
  }

  const existingToken = readDeviceToken(c.req.raw);
  const token = existingToken ?? newDeviceToken();
  const deviceHash = await hashToken(token);
  const cookie = { 'set-cookie': cookieHeader(DEVICE_COOKIE, token) };

  // Un móvil nuevo aún no tiene cookie: para él solo cuenta el límite por red.
  const allowed = await allowRequest(c.env, c.executionCtx, [
    ...(existingToken
      ? [
          {
            action: 'signup',
            scope: 'device',
            actor: 'customer',
            key: deviceHash,
            businessId: link.businessId,
          } as const,
        ]
      : []),
    {
      action: 'signup',
      scope: 'network',
      actor: 'customer',
      key: `${clientIp(c.req.raw)}:${link.businessId}`,
      businessId: link.businessId,
    },
  ]);
  if (!allowed) return tooMany();

  if (existingToken && (await findCard(c.env.DB, link.businessId, deviceHash))) {
    return redirect(`/l/tarjeta/${link.businessId}`, cookie);
  }

  const created = await createCard(c.env.DB, {
    businessId: link.businessId,
    deviceHash,
    name,
    phone,
    marketing: form.get('promos') === 'on',
    firstStamp: source === 'nfc' ? { slug } : null,
    now: Date.now(),
    offsetMinutes: offset(c.env),
  });
  if (!created.ok) {
    return retry(
      `Este número ya tiene una tarjeta en ${business.name} en otro móvil. Si cambiaste de móvil, pídele ayuda al local.`,
    );
  }
  return redirect(`/l/tarjeta/${link.businessId}?bienvenida=1`, cookie);
});

loyaltyRoutes.get('/l/tarjeta/:businessId', async (c) => {
  const businessId = c.req.param('businessId');
  const business = await loadBusiness(c.env.LINKS, businessId);
  if (!business?.loyaltyVisits) return notAvailable();
  const card = await currentCard(c, businessId);
  if (!card) {
    return html(
      messagePage(
        'No tienes tarjeta aquí',
        `Para crear tu tarjeta de ${business.name}, acerca tu móvil al stand del local.`,
      ),
      404,
    );
  }
  const now = Date.now();
  const pending = await findPendingRedemption(c.env.DB, card.id, now - DAY_MS);
  return html(
    cardPage({
      businessId,
      businessName: business.name,
      customerName: card.name,
      visits: business.loyaltyVisits,
      stamps: effectiveStamps(card, now),
      message: c.req.query('bienvenida') ? 'welcome' : 'view',
      continueUrl: null,
      pendingCode: pending?.code ?? null,
    }),
  );
});

loyaltyRoutes.get('/l/canjear/:businessId', async (c) => {
  const businessId = c.req.param('businessId');
  const business = await loadBusiness(c.env.LINKS, businessId);
  if (!business?.loyaltyVisits) return notAvailable();
  return html(redeemConfirmPage({ businessId, businessName: business.name }));
});

loyaltyRoutes.post('/l/canjear/:businessId', async (c) => {
  const businessId = c.req.param('businessId');
  const business = await loadBusiness(c.env.LINKS, businessId);
  if (!business?.loyaltyVisits) return notAvailable();
  const card = await currentCard(c, businessId);
  if (!card) return redirect(`/l/tarjeta/${businessId}`);
  const allowed = await allowRequest(c.env, c.executionCtx, [
    {
      action: 'redeem',
      scope: 'device',
      actor: 'customer',
      key: await hashToken(readDeviceToken(c.req.raw) ?? ''),
      businessId,
    },
  ]);
  if (!allowed) return tooMany();
  const code = await redeem(c.env.DB, card, {
    visitsRequired: business.loyaltyVisits,
    now: Date.now(),
  });
  if (!code) {
    return html(
      messagePage('Aún no tienes el premio', 'Te faltan sellos para canjear. ¡Sigue visitándonos!'),
      409,
    );
  }
  return redirect(`/l/canje/${code}`);
});

/** Pantalla del cliente con el QR único del canje. Solo la ve el móvil dueño de la tarjeta. */
loyaltyRoutes.get('/l/canje/:code', async (c) => {
  const code = c.req.param('code');
  const redemption = REDEMPTION_CODE_PATTERN.test(code)
    ? await findRedemption(c.env.DB, code)
    : null;
  const token = readDeviceToken(c.req.raw);
  if (!redemption || !token || redemption.deviceHash !== (await hashToken(token))) {
    return html(messagePage('Canje no encontrado', 'Este canje no existe o no es tuyo.'), 404);
  }
  const business = await loadBusiness(c.env.LINKS, redemption.businessId);
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const origin = new URL(c.req.url).origin;
  return new Response(
    redemptionPage({
      businessName: business?.name ?? '',
      businessId: redemption.businessId,
      code,
      validateUrl: `${origin}/v/${code}`,
      createdAt: redemption.createdAt,
      validatedAt: redemption.validatedAt,
      color: colorOfDay(localDay(Date.now(), offset(c.env))),
      nonce,
    }),
    {
      headers: pageHeaders(
        `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      ),
    },
  );
});

loyaltyRoutes.get('/l/canje/:code/estado', async (c) => {
  const code = c.req.param('code');
  const redemption = REDEMPTION_CODE_PATTERN.test(code)
    ? await findRedemption(c.env.DB, code)
    : null;
  const token = readDeviceToken(c.req.raw);
  if (!redemption || !token || redemption.deviceHash !== (await hashToken(token))) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ validated: redemption.validatedAt !== null }, 200, {
    'cache-control': 'no-store',
  });
});

/** Reporte del negocio cuyo móvil del personal está activado como validador. */
async function staffReport(c: AppContext): Promise<ReportRecord | null> {
  const token = readCookie(c.req.raw, STAFF_COOKIE);
  if (!token || !REPORT_TOKEN_PATTERN.test(token)) return null;
  const parsed = ReportRecord.safeParse(await c.env.LINKS.get(reportKey(token), 'json'));
  return parsed.success ? parsed.data : null;
}

/** El cajero escanea el QR del cliente con la cámara: abre esta URL en su móvil. */
loyaltyRoutes.get('/v/:code', async (c) => {
  const report = await staffReport(c);
  // El personal (cookie de validador) tiene 3× el límite público.
  const allowed = await allowRequest(c.env, c.executionCtx, [
    report
      ? {
          action: 'validate',
          scope: 'staff',
          actor: 'staff',
          key: await hashToken(readCookie(c.req.raw, STAFF_COOKIE) ?? ''),
          businessId: report.businessId,
        }
      : {
          action: 'validate',
          scope: 'network',
          actor: 'anonymous',
          key: clientIp(c.req.raw),
          businessId: null,
        },
  ]);
  if (!allowed) return tooMany();
  if (!report) return html(validationPage(null, { kind: 'not_staff' }));
  const code = parseRedemptionCode(c.req.param('code'));
  const redemption = code ? await findRedemption(c.env.DB, code) : null;
  let outcome: ValidationOutcome;
  if (!redemption || redemption.businessId !== report.businessId) {
    outcome = { kind: 'invalid' };
  } else if (await validateRedemption(c.env.DB, redemption.code, Date.now())) {
    outcome = {
      kind: 'valid',
      customerName: redemption.customerName,
      visits: redemption.visitsRequired,
      createdAt: redemption.createdAt,
    };
  } else {
    outcome = {
      kind: 'already',
      validatedAt: redemption.validatedAt ?? Date.now(),
      customerName: redemption.customerName,
    };
  }
  return html(validationPage(report.name, outcome), outcome.kind === 'invalid' ? 404 : 200);
});

/** Código tecleado a mano desde el enlace de estadísticas. */
loyaltyRoutes.get('/v', (c) => {
  const code = parseRedemptionCode(c.req.query('codigo') ?? '');
  return code ? redirect(`/v/${code}`) : html(validationPage(null, { kind: 'invalid' }), 404);
});

/** Activa este móvil como validador de canjes del negocio (desde su enlace de estadísticas). */
loyaltyRoutes.post('/r/:token/validador', async (c) => {
  const token = c.req.param('token');
  if (!REPORT_TOKEN_PATTERN.test(token) || !(await c.env.LINKS.get(reportKey(token)))) {
    return notAvailable();
  }
  return redirect(`/r/${token}#validar`, { 'set-cookie': cookieHeader(STAFF_COOKIE, token) });
});

loyaltyRoutes.get('/l/privacidad/:businessId', async (c) => {
  const business = await loadBusiness(c.env.LINKS, c.req.param('businessId'));
  if (!business) return notAvailable();
  return html(privacyPage(business.name));
});

loyaltyRoutes.get('/l/baja/:businessId', async (c) => {
  const businessId = c.req.param('businessId');
  const business = await loadBusiness(c.env.LINKS, businessId);
  if (!business) return notAvailable();
  return html(deleteConfirmPage({ businessId, businessName: business.name }));
});

loyaltyRoutes.post('/l/baja/:businessId', async (c) => {
  const businessId = c.req.param('businessId');
  const card = await currentCard(c, businessId);
  if (card) await deleteCard(c.env.DB, card.id);
  return html(
    messagePage(
      'Listo',
      'Borramos tu tarjeta, tu nombre y tu teléfono. ¡Gracias por haber participado!',
    ),
  );
});
