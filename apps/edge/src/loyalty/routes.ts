import {
  BusinessRecord,
  businessKey,
  LinkRecord,
  normalizePhone,
  PAIRING_PATH,
  parseRedemptionCode,
  REDEMPTION_CODE_PATTERN,
} from '@nfc/shared';
import { Hono, type Context } from 'hono';
import type { Env } from '../env.js';
import { pageHeaders, STRICT_CSP } from '../html.js';
import { allowRequest, clientIp } from '../rate-limit.js';
import { scannerCsp } from './scanner.js';
import {
  CHECKIN_PATH,
  PRESENCE_PASS_COOKIE,
  PRESENCE_PASS_MS,
  presencePass,
  rotatingQr,
  rotatingQrToken,
  verifyPresencePass,
  type PresenceMethod,
} from '../presence/index.js';
import {
  cardPage,
  colorOfDay,
  deleteConfirmPage,
  messagePage,
  pairingConfirmPage,
  pairingInvalidPage,
  pairingTooManyPage,
  privacyPage,
  redeemConfirmPage,
  redemptionPage,
  signupPage,
  staffHomePage,
  staffQrPage,
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
} from './security.js';
import {
  completePairing,
  pendingPairing,
  publicOrigin,
  readStaffDevice,
  STAFF_COOKIE,
  staffCookie,
} from '../staff/store.js';
import {
  addStamp,
  createCard,
  deleteCard,
  effectiveStamps,
  findCard,
  findPendingRedemption,
  findRedemption,
  localDay,
  qrKeyVersion,
  redeem,
  validateRedemption,
} from './store.js';

type AppContext = Context<{ Bindings: Env }>;
type LoyaltyLink = Extract<LinkRecord, { type: 'loyalty' }>;

const DAY_MS = 86_400_000;
/** "Chip" con el que se registran los sellos del QR rotativo (loyalty_stamps.slug). */
export const QR_STAMP_SLUG = 'qr';

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
      method: 'static_nfc',
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
  const source = form.get('fuente') === 'qr' ? 'qr' : 'nfc';
  return signup(c, form, {
    businessId: link.businessId,
    business,
    slug,
    source,
    // El QR fijo del chip (?s=q) muestra la tarjeta pero no prueba presencia: sin sello.
    firstStamp: source === 'nfc' ? { slug, method: 'static_nfc' } : null,
  });
});

/**
 * QR rotativo del local (fase 5): prueba fuerte de presencia. Con tarjeta suma el sello del día;
 * sin tarjeta emite un pase de presencia de 10 minutos y muestra el alta.
 */
loyaltyRoutes.get(`${CHECKIN_PATH}/:token`, async (c) => {
  const now = Date.now();
  const proof = await rotatingQr.verify(
    { token: c.req.param('token') },
    {
      masterKey: c.env.PRESENCE_MASTER_KEY,
      qrKeyVersion: async (businessId) => {
        const business = await loadBusiness(c.env.LINKS, businessId);
        return business?.loyaltyVisits ? qrKeyVersion(c.env.DB, businessId) : null;
      },
    },
    now,
  );
  if (!proof.proven) {
    return html(
      messagePage(
        proof.reason === 'expired' ? 'Este QR ya caducó' : 'QR no válido',
        'El QR del local cambia cada minuto. Escanea el que se ve ahora en su pantalla.',
      ),
      proof.reason === 'expired' ? 410 : 404,
    );
  }
  const businessId = proof.businessId;
  const business = (await loadBusiness(c.env.LINKS, businessId))!;
  const visits = business.loyaltyVisits!;
  const card = await currentCard(c, businessId);
  if (!card) {
    const pass = await presencePass(c.env.PRESENCE_MASTER_KEY!, businessId, now);
    return html(
      signupPage({
        businessId,
        businessName: business.name,
        visits,
        slug: '',
        action: `${CHECKIN_PATH}/registro/${businessId}`,
        source: 'qr',
      }),
      200,
      {
        'set-cookie': `${PRESENCE_PASS_COOKIE}=${encodeURIComponent(pass)}; Max-Age=${PRESENCE_PASS_MS / 1000}; Path=${CHECKIN_PATH}/registro/; HttpOnly; Secure; SameSite=Lax`,
      },
    );
  }
  const stamped = await addStamp(c.env.DB, card, {
    slug: QR_STAMP_SLUG,
    method: proof.method,
    visitsRequired: visits,
    now,
    offsetMinutes: offset(c.env),
  });
  const pending = await findPendingRedemption(c.env.DB, card.id, now - DAY_MS);
  return html(
    cardPage({
      businessId,
      businessName: business.name,
      customerName: stamped.card.name,
      visits,
      stamps: effectiveStamps(stamped.card, now),
      message: stamped.result,
      continueUrl: null,
      pendingCode: pending?.code ?? null,
    }),
    200,
    { 'set-cookie': cookieHeader(DEVICE_COOKIE, readDeviceToken(c.req.raw)!) },
  );
});

/** Alta desde el QR rotativo: el pase de presencia (10 min) da el primer sello. */
loyaltyRoutes.post(`${CHECKIN_PATH}/registro/:businessId`, async (c) => {
  const businessId = c.req.param('businessId');
  const business = await loadBusiness(c.env.LINKS, businessId);
  if (!business?.loyaltyVisits) return notAvailable();
  const form = await c.req.formData();
  const present = await verifyPresencePass(
    c.env.PRESENCE_MASTER_KEY,
    readCookie(c.req.raw, PRESENCE_PASS_COOKIE),
    businessId,
    Date.now(),
  );
  return signup(c, form, {
    businessId,
    business,
    slug: null,
    source: 'qr',
    firstStamp: present ? { slug: QR_STAMP_SLUG, method: 'rotating_qr' } : null,
  });
});

async function signup(
  c: AppContext,
  form: FormData,
  target: {
    businessId: string;
    business: BusinessRecord;
    slug: string | null;
    source: 'nfc' | 'qr';
    firstStamp: { slug: string; method: PresenceMethod } | null;
  },
): Promise<Response> {
  const { business, slug, source } = target;
  const link = { businessId: target.businessId };
  const name = String(form.get('nombre') ?? '')
    .replace(/[\p{C}<>]/gu, '')
    .trim()
    .slice(0, 60);
  const phoneInput = String(form.get('telefono') ?? '');
  const values = { name, phone: phoneInput };
  const retry = (error: string) =>
    html(
      signupPage({
        businessId: link.businessId,
        businessName: business.name,
        visits: business.loyaltyVisits!,
        slug: slug ?? '',
        action: slug ? undefined : `${CHECKIN_PATH}/registro/${target.businessId}`,
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
    firstStamp: target.firstStamp,
    now: Date.now(),
    offsetMinutes: offset(c.env),
  });
  if (!created.ok) {
    return retry(
      `Este número ya tiene una tarjeta en ${business.name} en otro móvil. Si cambiaste de móvil, pídele ayuda al local.`,
    );
  }
  return redirect(`/l/tarjeta/${link.businessId}?bienvenida=1`, cookie);
}

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
        `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
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

/** El cajero escanea el QR del cliente con la cámara: abre esta URL en su móvil vinculado. */
/** QR rotativo en un móvil vinculado del local (antes de /v/:code para que no lo tome como código). */
loyaltyRoutes.get('/v/qr', async (c) => {
  const device = await readStaffDevice(c.env, c.req.raw, c.executionCtx);
  if (!device) return html(validationPage(null, { kind: 'not_staff' }));
  const business = await loadBusiness(c.env.LINKS, device.businessId);
  if (!business?.loyaltyVisits) return notAvailable();
  const key = c.env.PRESENCE_MASTER_KEY;
  const url = key
    ? `${publicOrigin(c.env)}${CHECKIN_PATH}/${
        (
          await rotatingQrToken(
            key,
            device.businessId,
            await qrKeyVersion(c.env.DB, device.businessId),
            Date.now(),
          )
        ).token
      }`
    : null;
  return html(staffQrPage({ businessName: device.businessName, url }));
});

loyaltyRoutes.get('/v/:code', async (c) => {
  const device = await readStaffDevice(c.env, c.req.raw, c.executionCtx);
  // El personal (móvil vinculado) tiene 3× el límite público.
  const allowed = await allowRequest(c.env, c.executionCtx, [
    device
      ? {
          action: 'validate',
          scope: 'staff',
          actor: 'staff',
          key: device.id,
          businessId: device.businessId,
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
  if (!device) return html(validationPage(null, { kind: 'not_staff' }));
  const code = parseRedemptionCode(c.req.param('code'));
  const redemption = code ? await findRedemption(c.env.DB, code) : null;
  let outcome: ValidationOutcome;
  if (!redemption || redemption.businessId !== device.businessId) {
    outcome = { kind: 'invalid' };
  } else if (await validateRedemption(c.env.DB, redemption.code, Date.now(), device.id)) {
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
  return html(
    validationPage(device.businessName, outcome),
    outcome.kind === 'invalid' ? 404 : 200,
    // Renueva la cookie del móvil (máximo 400 días).
    { 'set-cookie': staffCookie(readCookie(c.req.raw, STAFF_COOKIE) ?? '') },
  );
});

/** Inicio del móvil del personal: escribir el código a mano si no se puede escanear. */
loyaltyRoutes.get('/v', async (c) => {
  const code = parseRedemptionCode(c.req.query('codigo') ?? '');
  if (code) return redirect(`/v/${code}`);
  const device = await readStaffDevice(c.env, c.req.raw, c.executionCtx);
  if (!device) return html(validationPage(null, { kind: 'not_staff' }));
  const nonce = crypto.randomUUID().replace(/-/g, '');
  return new Response(
    staffHomePage({
      businessName: device.businessName,
      label: device.label,
      color: colorOfDay(localDay(Date.now(), offset(c.env))),
      error: c.req.query('codigo') !== undefined,
      nonce,
      autostart: c.req.query('escanear') === '1',
    }),
    { headers: pageHeaders(scannerCsp(nonce)) },
  );
});

/** Vincular un móvil del personal: el GET no gasta el enlace (lo pueden abrir previsualizadores). */
loyaltyRoutes.get(`${PAIRING_PATH}/:token`, async (c) => {
  const pending = await pendingPairing(c.env, c.req.param('token'));
  if (!pending) return html(pairingInvalidPage(), 410);
  return html(pairingConfirmPage({ ...pending, token: c.req.param('token') }));
});

loyaltyRoutes.post(`${PAIRING_PATH}/:token`, async (c) => {
  const result = await completePairing(c.env, c.req.param('token'));
  if (!result.ok) {
    return html(
      result.error === 'too_many' ? pairingTooManyPage() : pairingInvalidPage(),
      result.error === 'too_many' ? 409 : 410,
    );
  }
  return redirect('/v', { 'set-cookie': staffCookie(result.cookieToken) });
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
