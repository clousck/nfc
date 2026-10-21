import { ReportRecord, REPORT_TOKEN_PATTERN, reportKey } from '@nfc/shared';

const DAY_MS = 86_400_000;
export const REPORT_DAYS = 30;

export interface ReportStats {
  /** Escaneos por día local (YYYY-MM-DD), del más antiguo al de hoy; REPORT_DAYS entradas. */
  days: Array<{ date: string; count: number }>;
  /** Escaneos por hora local (0–23) en los últimos REPORT_DAYS días. */
  hours: number[];
  nfc: number;
  qr: number;
  ios: number;
  android: number;
  other: number;
  /** Por chip: total desde su asignación, últimos 30 días y último escaneo. */
  tags: Array<{
    slug: string;
    number: number;
    label: string | null;
    total: number;
    last30: number;
    lastAt: number | null;
  }>;
}

export async function loadReport(kv: KVNamespace, token: string): Promise<ReportRecord | null> {
  if (!REPORT_TOKEN_PATTERN.test(token)) return null;
  const raw = await kv.get(reportKey(token), 'json');
  if (raw === null) return null;
  const parsed = ReportRecord.safeParse(raw);
  if (!parsed.success) {
    console.error('Registro de reporte inválido', { issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}

/** Fecha local YYYY-MM-DD de un instante, con desplazamiento fijo en minutos (Ecuador: -300). */
function localDate(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export async function queryReportStats(
  db: D1Database,
  report: ReportRecord,
  now: number,
  offsetMinutes: number,
): Promise<ReportStats> {
  // Inicio del día local de hace REPORT_DAYS-1 días, en epoch ms UTC.
  const todayLocal = localDate(now, offsetMinutes);
  const startOfToday = Date.parse(`${todayLocal}T00:00:00Z`) - offsetMinutes * 60_000;
  const windowStart = startOfToday - (REPORT_DAYS - 1) * DAY_MS;

  const days = Array.from({ length: REPORT_DAYS }, (_, i) => ({
    date: localDate(windowStart + i * DAY_MS + 12 * 3_600_000, offsetMinutes),
    count: 0,
  }));
  const empty: ReportStats = {
    days,
    hours: Array.from({ length: 24 }, () => 0),
    nfc: 0,
    qr: 0,
    ios: 0,
    android: 0,
    other: 0,
    tags: report.tags.map((t) => ({ ...t, total: 0, last30: 0, lastAt: null })),
  };
  if (report.tags.length === 0) return empty;

  // Cada chip cuenta solo desde que se asignó a este negocio.
  const values = report.tags.map(() => '(?, ?)').join(', ');
  const tagParams = report.tags.flatMap((t) => [t.slug, t.since ?? 0]);
  const cte = `WITH t(slug, since) AS (VALUES ${values})`;
  const join = 'FROM scans s JOIN t ON s.slug = t.slug AND s.ts >= t.since WHERE s.is_bot = 0';
  const offsetSeconds = offsetMinutes * 60;

  const [byDay, byHour, bySplit, byTag] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `${cte} SELECT date(s.ts / 1000 + ?, 'unixepoch') AS d, COUNT(*) AS n ${join} AND s.ts >= ? GROUP BY d`,
      )
      .bind(...tagParams, offsetSeconds, windowStart),
    db
      .prepare(
        `${cte} SELECT CAST(strftime('%H', s.ts / 1000 + ?, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS n ${join} AND s.ts >= ? GROUP BY h`,
      )
      .bind(...tagParams, offsetSeconds, windowStart),
    db
      .prepare(
        `${cte} SELECT s.source AS source, s.os AS os, COUNT(*) AS n ${join} AND s.ts >= ? GROUP BY s.source, s.os`,
      )
      .bind(...tagParams, windowStart),
    db
      .prepare(
        `${cte} SELECT s.slug AS slug, COUNT(*) AS total, SUM(s.ts >= ?) AS last30, MAX(s.ts) AS last_at ${join} GROUP BY s.slug`,
      )
      .bind(...tagParams, windowStart),
  ]);

  const stats = empty;
  const dayIndex = new Map(stats.days.map((d, i) => [d.date, i]));
  for (const row of byDay?.results ?? []) {
    const i = dayIndex.get(String(row['d']));
    if (i !== undefined) stats.days[i]!.count = Number(row['n']);
  }
  for (const row of byHour?.results ?? []) {
    const h = Number(row['h']);
    if (h >= 0 && h < 24) stats.hours[h] = Number(row['n']);
  }
  for (const row of bySplit?.results ?? []) {
    const n = Number(row['n']);
    if (row['source'] === 'qr') stats.qr += n;
    else stats.nfc += n;
    if (row['os'] === 'ios') stats.ios += n;
    else if (row['os'] === 'android') stats.android += n;
    else stats.other += n;
  }
  const tagRows = new Map((byTag?.results ?? []).map((row) => [String(row['slug']), row]));
  stats.tags = report.tags.map((t) => {
    const row = tagRows.get(t.slug);
    return {
      ...t,
      total: Number(row?.['total'] ?? 0),
      last30: Number(row?.['last30'] ?? 0),
      lastAt: row?.['last_at'] == null ? null : Number(row['last_at']),
    };
  });
  return stats;
}
