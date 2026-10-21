import { detectOs, isBot, sourceFromParam, SOURCE_PARAM, type ScanEvent } from '@nfc/shared';

/** Construye el evento a partir de la petición. No guarda IP ni el User-Agent completo. */
export function buildScanEvent(request: Request, slug: string, now = Date.now()): ScanEvent {
  const url = new URL(request.url);
  const userAgent = request.headers.get('user-agent');
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  return {
    slug,
    ts: now,
    source: sourceFromParam(url.searchParams.get(SOURCE_PARAM)),
    os: detectOs(userAgent),
    country: typeof cf?.country === 'string' ? cf.country : null,
    city: typeof cf?.city === 'string' ? cf.city : null,
    isBot: isBot(userAgent),
  };
}

export async function recordScan(db: D1Database, event: ScanEvent): Promise<void> {
  await db
    .prepare(
      'INSERT INTO scans (slug, ts, source, os, country, city, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      event.slug,
      event.ts,
      event.source,
      event.os,
      event.country,
      event.city,
      event.isBot ? 1 : 0,
    )
    .run();
}
