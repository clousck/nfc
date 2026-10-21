import { Hono } from 'hono';
import { isValidSlug, LinkRecord } from '@nfc/shared';
import type { Env } from './env.js';
import { FALLBACK_HTML } from './fallback.js';
import { buildScanEvent, recordScan } from './scan.js';

const app = new Hono<{ Bindings: Env }>();

// Las respuestas no se cachean: el destino puede cambiar y cada escaneo debe llegar al Worker.
const NO_STORE = 'no-store';

function fallback(status: 404 | 503 = 404): Response {
  return new Response(FALLBACK_HTML, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_STORE },
  });
}

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

app.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!isValidSlug(slug)) return fallback();

  // Se registra todo escaneo de un slug con formato válido (también inexistentes o
  // inactivos) para poder diagnosticar chips mal configurados. No bloquea la respuesta.
  const event = buildScanEvent(c.req.raw, slug);
  c.executionCtx.waitUntil(
    recordScan(c.env.DB, event).catch((err: unknown) => {
      console.error('No se pudo registrar el escaneo', { slug, err: String(err) });
    }),
  );

  let link: LinkRecord | null;
  try {
    link = await readLink(c.env.LINKS, slug);
  } catch (err) {
    console.error('Error leyendo KV', { slug, err: String(err) });
    return fallback(503);
  }

  if (!link || !link.active) return fallback();

  if (link.type === 'redirect') {
    return new Response(null, {
      status: 302,
      headers: { location: link.url, 'cache-control': NO_STORE },
    });
  }

  // Las landings se renderizan en la Fase 3; mientras tanto, página genérica.
  return fallback();
});

app.notFound(() => fallback());

app.onError((err) => {
  console.error('Error no controlado', String(err));
  return fallback(503);
});

export default app;
