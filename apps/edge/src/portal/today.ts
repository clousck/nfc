import type { ProjectedTag } from '../internal/control-plane.js';

// Datos de la pantalla "Hoy" del portal: cada visita de hoy (un sello si el negocio tiene
// fidelidad, un escaneo si no) para dibujar la franja del día, y cuántas hubo ayer hasta la misma
// hora para que la cifra tenga con qué compararse.

const DAY_MS = 86_400_000;
/** D1 admite 100 parámetros por consulta: los chips de un negocio caben de sobra. */
const MAX_SLUGS = 90;

export interface TodayVisits {
  kind: 'stamps' | 'scans';
  /** Marcas de hoy (epoch ms), de la más antigua a la más reciente. */
  times: number[];
  /** Cuántas hubo ayer desde medianoche hasta esta misma hora. */
  yesterdaySameTime: number;
  /** Medianoche local de hoy (epoch ms). */
  dayStart: number;
}

/** Medianoche local (epoch ms) con un desplazamiento fijo, p. ej. -300 para Ecuador. */
export function localDayStart(now: number, offsetMinutes: number): number {
  const shift = offsetMinutes * 60_000;
  return Math.floor((now + shift) / DAY_MS) * DAY_MS - shift;
}

export async function todayVisits(
  db: D1Database,
  input: {
    businessId: string;
    tags: ProjectedTag[];
    loyalty: boolean;
    now: number;
    offsetMinutes: number;
  },
): Promise<TodayVisits> {
  const dayStart = localDayStart(input.now, input.offsetMinutes);
  const since = dayStart - DAY_MS;
  const until = input.now - DAY_MS;

  if (input.loyalty) {
    const [today, yesterday] = await db.batch<{ ts?: number; n?: number }>([
      db
        .prepare('SELECT ts FROM loyalty_stamps WHERE business_id = ? AND ts >= ? ORDER BY ts')
        .bind(input.businessId, dayStart),
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM loyalty_stamps WHERE business_id = ? AND ts >= ? AND ts < ?',
        )
        .bind(input.businessId, since, until),
    ]);
    return {
      kind: 'stamps',
      times: (today?.results ?? []).map((r) => Number(r.ts)),
      yesterdaySameTime: Number(yesterday?.results?.[0]?.n ?? 0),
      dayStart,
    };
  }

  const slugs = input.tags.map((t) => t.slug).slice(0, MAX_SLUGS);
  if (slugs.length === 0) return { kind: 'scans', times: [], yesterdaySameTime: 0, dayStart };
  const marks = slugs.map(() => '?').join(', ');
  const [today, yesterday] = await db.batch<{ ts?: number; n?: number }>([
    db
      .prepare(
        `SELECT ts FROM scans WHERE is_bot = 0 AND ts >= ? AND slug IN (${marks}) ORDER BY ts LIMIT 2000`,
      )
      .bind(dayStart, ...slugs),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM scans WHERE is_bot = 0 AND ts >= ? AND ts < ? AND slug IN (${marks})`,
      )
      .bind(since, until, ...slugs),
  ]);
  return {
    kind: 'scans',
    times: (today?.results ?? []).map((r) => Number(r.ts)),
    yesterdaySameTime: Number(yesterday?.results?.[0]?.n ?? 0),
    dayStart,
  };
}
