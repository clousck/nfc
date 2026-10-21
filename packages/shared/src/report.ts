import { z } from 'zod';
import { BusinessId, Slug } from './schemas.js';
import { randomBase62 } from './slug.js';

/** Token del enlace privado de estadísticas: 24 chars base62 (~143 bits), imposible de adivinar. */
export const REPORT_TOKEN_LENGTH = 24;
export const REPORT_TOKEN_PATTERN = /^[0-9A-Za-z]{24}$/;

/** Ruta pública del enlace: `<PUBLIC_BASE_URL>/r/<token>`. */
export const REPORT_PATH_PREFIX = '/r/';

/** Las claves de chips son base62 puro; el prefijo con `:` nunca choca con un slug. */
const REPORT_KEY_PREFIX = 'report:';

export function generateReportToken(): string {
  return randomBase62(REPORT_TOKEN_LENGTH);
}

export function reportKey(token: string): string {
  return `${REPORT_KEY_PREFIX}${token}`;
}

export function isReportKey(key: string): boolean {
  return key.startsWith(REPORT_KEY_PREFIX);
}

export function buildReportUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${REPORT_PATH_PREFIX}${token}`;
}

/** Valor publicado en KV `LINKS` bajo `report:<token>`: lo que el Worker necesita para la página. */
export const ReportRecord = z.object({
  businessId: BusinessId,
  name: z.string().min(1).max(120),
  tags: z
    .array(
      z.object({
        slug: Slug,
        number: z.number().int().positive(),
        label: z.string().max(80).nullable(),
        /** Desde cuándo cuentan los escaneos de este chip para este negocio (epoch ms). */
        since: z.number().int().nonnegative().nullable(),
      }),
    )
    .max(40),
});
export type ReportRecord = z.infer<typeof ReportRecord>;
