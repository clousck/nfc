import { AccountEmail, LOGIN_PATH } from '@nfc/shared';
import { Hono, type Context } from 'hono';
import type { Env } from '../env.js';
import { pageHeaders, STRICT_CSP } from '../html.js';
import { hashToken, isSameOrigin } from '../loyalty/security.js';
import { allowRequest, clientIp } from '../rate-limit.js';
import { businessRoutes } from './business-routes.js';
import {
  checkEmailPage,
  confirmLoginPage,
  homePage,
  invalidLinkPage,
  loginPage,
  messagePage,
} from './pages.js';
import {
  CLEAR_SESSION_COOKIE,
  consumeLoginToken,
  isLoginTokenUsable,
  readSession,
  revokeSession,
  sendLoginEmail,
  sessionCookie,
  type PortalSession,
} from './session.js';

// Portal de negocios: mismo Worker, otro hostname (negocios.penginexr.com). La API interna
// no existe aquí: este router solo conoce las rutas del portal.

type PortalEnv = { Bindings: Env; Variables: { session: PortalSession } };
type PortalContext = Context<PortalEnv>;

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...pageHeaders(STRICT_CSP), ...headers },
  });
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store', ...headers },
  });
}

export const portalRoutes = new Hono<PortalEnv>();

// Los formularios solo se aceptan desde nuestras propias páginas (CSRF).
portalRoutes.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !isSameOrigin(c.req.raw)) {
    return html(messagePage('Solicitud no válida', 'Vuelve a intentarlo desde el portal.'), 403);
  }
  await next();
});

portalRoutes.get('/health', (c) => c.text('ok', 200, { 'cache-control': 'no-store' }));

portalRoutes.get(LOGIN_PATH, async (c) => {
  if (await readSession(c.env, c.req.raw, c.executionCtx)) return redirect('/');
  return html(loginPage());
});

portalRoutes.post(LOGIN_PATH, async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get('email') ?? '').slice(0, 300);
  const email = AccountEmail.safeParse(raw);
  if (!email.success) {
    return html(loginPage({ error: 'Escribe un correo válido.', email: raw }), 400);
  }
  const allowed = await allowRequest(c.env, c.executionCtx, [
    {
      action: 'login',
      scope: 'login',
      actor: 'anonymous',
      key: await hashToken(email.data),
      businessId: null,
    },
    {
      action: 'login',
      scope: 'network',
      actor: 'anonymous',
      key: clientIp(c.req.raw),
      businessId: null,
    },
  ]);
  if (!allowed) {
    return html(
      loginPage({ error: 'Demasiados intentos. Espera un minuto y vuelve a probar.', email: raw }),
      429,
    );
  }
  // En segundo plano: la respuesta tarda lo mismo exista o no la cuenta.
  c.executionCtx.waitUntil(
    sendLoginEmail(c.env, email.data).catch((err: unknown) => {
      console.error('No se pudo enviar el enlace de acceso', String(err));
    }),
  );
  return html(checkEmailPage(email.data));
});

portalRoutes.get(`${LOGIN_PATH}/:token`, async (c) => {
  const token = c.req.param('token');
  if (!(await isLoginTokenUsable(c.env, token))) return html(invalidLinkPage(), 410);
  return html(confirmLoginPage(token));
});

portalRoutes.post(`${LOGIN_PATH}/:token`, async (c) => {
  const session = await consumeLoginToken(c.env, c.req.param('token'));
  if (!session) return html(invalidLinkPage(), 410);
  return redirect('/', { 'set-cookie': sessionCookie(session) });
});

// A partir de aquí, todo exige sesión.
portalRoutes.use('*', async (c: PortalContext, next) => {
  const session = await readSession(c.env, c.req.raw, c.executionCtx);
  if (!session) {
    return c.req.method === 'GET' ? redirect(LOGIN_PATH) : html(invalidLinkPage(), 401);
  }
  c.set('session', session);
  await next();
});

portalRoutes.post('/salir', async (c) => {
  await revokeSession(c.env, c.get('session').idHash);
  return redirect(LOGIN_PATH, { 'set-cookie': CLEAR_SESSION_COOKIE });
});

portalRoutes.get('/', (c) => {
  const session = c.get('session');
  // Con un solo negocio se entra directo a él.
  const only = session.businesses.length === 1 ? session.businesses[0] : undefined;
  if (only) return redirect(`/n/${only.id}`);
  return html(homePage(session));
});

portalRoutes.route('/n/:businessId', businessRoutes);

portalRoutes.notFound(() =>
  html(messagePage('Página no encontrada', 'Esta dirección no existe en el portal.'), 404),
);

portalRoutes.onError((err) => {
  console.error('Error en el portal', String(err));
  return html(messagePage('Algo falló', 'Inténtalo de nuevo en unos minutos.'), 500);
});
