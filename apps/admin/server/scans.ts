import type { DeviceOs, ScanSource } from '@nfc/shared';
import type { ScanStore } from './cloudflare.js';

export interface RecentScan {
  ts: number;
  source: ScanSource;
  os: DeviceOs | null;
  country: string | null;
  city: string | null;
}

export interface TagScanStats {
  /** Desde cuándo se cuenta (asignación al negocio actual); null = desde siempre. */
  since: number | null;
  total: number;
  nfc: number;
  qr: number;
  ios: number;
  android: number;
  other: number;
  /** Visitas de crawlers (vistas previas de WhatsApp, etc.): no cuentan en el total. */
  bots: number;
  lastAt: number | null;
  recent: RecentScan[];
}

interface SummaryRow {
  total: number | null;
  nfc: number | null;
  qr: number | null;
  ios: number | null;
  android: number | null;
  bots: number | null;
  last_at: number | null;
}

const SUMMARY_SQL = `
  SELECT
    SUM(is_bot = 0)                      AS total,
    SUM(is_bot = 0 AND source = 'nfc')   AS nfc,
    SUM(is_bot = 0 AND source = 'qr')    AS qr,
    SUM(is_bot = 0 AND os = 'ios')       AS ios,
    SUM(is_bot = 0 AND os = 'android')   AS android,
    SUM(is_bot = 1)                      AS bots,
    MAX(CASE WHEN is_bot = 0 THEN ts END) AS last_at
  FROM scans
  WHERE slug = ? AND ts >= ?`;

const RECENT_SQL = `
  SELECT ts, source, os, country, city
  FROM scans
  WHERE slug = ? AND ts >= ? AND is_bot = 0
  ORDER BY ts DESC
  LIMIT ?`;

export async function getTagScanStats(
  store: ScanStore,
  slug: string,
  since: number | null,
  recentLimit = 20,
): Promise<TagScanStats> {
  const from = since ?? 0;
  const [summaryRows, recent] = await Promise.all([
    store.query<SummaryRow>(SUMMARY_SQL, [slug, from]),
    store.query<RecentScan>(RECENT_SQL, [slug, from, recentLimit]),
  ]);
  const s = summaryRows[0];
  const total = s?.total ?? 0;
  const ios = s?.ios ?? 0;
  const android = s?.android ?? 0;
  return {
    since,
    total,
    nfc: s?.nfc ?? 0,
    qr: s?.qr ?? 0,
    ios,
    android,
    other: total - ios - android,
    bots: s?.bots ?? 0,
    lastAt: s?.last_at ?? null,
    recent,
  };
}
