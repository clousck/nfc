import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { vi } from 'vitest';
import worker from '../src/index.js';

// Utilidades comunes de los tests del portal: peticiones a cada host, datos de partida y un
// Resend simulado que guarda los correos enviados.

export const INTERNAL = 'test-internal-token-0123456789abcdef';
export const BIZ = 'b_cafe00000001';
export const OTHER = 'b_otro00000001';
export const PORTAL = 'https://negocios.penginexr.com';
export const ADMIN_EMAIL = 'admin@penginexr.com';

const testEnv = { ...env, RESEND_API_KEY: 're_test', ADMIN_NOTIFY_EMAIL: ADMIN_EMAIL };

export async function send(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export const internal = (method: string, path: string, body?: unknown) =>
  send(
    new Request(`https://go.penginexr.com/internal${path}`, {
      method,
      headers: { authorization: `Bearer ${INTERNAL}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

export function portal(
  method: string,
  path: string,
  init: { form?: Record<string, string>; cookie?: string; site?: string } = {},
) {
  const headers: Record<string, string> = { 'sec-fetch-site': init.site ?? 'same-origin' };
  if (init.cookie) headers['cookie'] = init.cookie;
  return send(
    new Request(`${PORTAL}${path}`, {
      method,
      headers,
      redirect: 'manual',
      body: init.form ? new URLSearchParams(init.form) : undefined,
    }),
  );
}

let revision = 1;

export async function business(
  id: string,
  options: { status?: string; loyaltyVisits?: number | null } = {},
) {
  await internal('PUT', `/businesses/${id}`, {
    id,
    name: id === BIZ ? 'Café X' : 'Otro',
    status: options.status ?? 'active',
    reportToken: null,
    loyaltyVisits: options.loyaltyVisits ?? null,
    revision: revision++,
  });
}

export async function tag(
  slug: string,
  number: number,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await internal('PUT', `/tags/${slug}`, {
    slug,
    number,
    businessId: BIZ,
    assignedAt: 100,
    label: 'Caja',
    type: 'redirect',
    targetUrl: 'https://x.ec',
    active: true,
    ...overrides,
    revision: revision++,
  });
}

export async function account(email = 'ana@cafe.ec', businessId = BIZ) {
  const res = await internal('POST', `/businesses/${businessId}/accounts`, { email });
  return ((await res.json()) as { id: string }).id;
}

export interface SentMail {
  to: string[];
  subject: string;
  text: string;
}

/** Simula Resend: devuelve la lista (se va llenando) de correos enviados. */
export function mockMail(): SentMail[] {
  const mails: SentMail[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.resend.com/emails') throw new Error(`fetch inesperado: ${url}`);
    mails.push(JSON.parse(String(init?.body)) as SentMail);
    return new Response('{"id":"x"}', { status: 200 });
  });
  return mails;
}

export const linkIn = (text: string) =>
  /https:\/\/negocios\.penginexr\.com\/entrar\/\S+/.exec(text)?.[0];

export const cookieOf = (res: Response) =>
  (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

export async function login(mails: SentMail[], email = 'ana@cafe.ec'): Promise<string> {
  await portal('POST', '/entrar', { form: { email } });
  const link = linkIn(mails.at(-1)?.text ?? '');
  if (!link) throw new Error('no llegó el correo');
  return cookieOf(await portal('POST', new URL(link).pathname));
}

export async function resetPortalTables(): Promise<void> {
  await env.DB.exec(
    'DELETE FROM sessions; DELETE FROM login_tokens; DELETE FROM memberships; DELETE FROM accounts; DELETE FROM audit_log; DELETE FROM business_profile; DELETE FROM business_settings; DELETE FROM tag_inventory; DELETE FROM tag_settings; DELETE FROM kv_published; DELETE FROM loyalty_cards;',
  );
  for (const { name } of (await env.LINKS.list()).keys) await env.LINKS.delete(name);
}
