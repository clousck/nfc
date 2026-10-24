import { TargetUrl } from '@nfc/shared';
import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const booleanFlag = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((value) => value === 'true' || value === '1');

/** https, o http solo hacia esta misma máquina (desarrollo con `wrangler dev`). */
const EdgeUrl = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const url = new URL(value);
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      return url.protocol === 'https:' || (url.protocol === 'http:' && local);
    } catch {
      return false;
    }
  }, 'Debe ser https:// (o http://localhost en desarrollo)');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/admin.db'),
  PUBLIC_BASE_URL: TargetUrl.default('https://go.penginexr.com'),
  /** URL del Worker para /internal/* (por defecto, la pública). */
  EDGE_URL: EdgeUrl.optional(),
  /** Secreto compartido con el Worker. Sin él, los cambios esperan en la cola. */
  INTERNAL_API_TOKEN: optionalString.pipe(z.string().min(32).optional()),
  CF_ACCESS_TEAM_DOMAIN: optionalString,
  CF_ACCESS_AUD: optionalString,
  AUTH_DISABLED: booleanFlag,
});

export interface Config {
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  /** API interna del Worker; null = sin configurar (el panel funciona, nada se publica). */
  edge: { baseUrl: string; token: string } | null;
  access: { teamDomain: string; aud: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración inválida:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;

  const edge = e.INTERNAL_API_TOKEN
    ? { baseUrl: e.EDGE_URL ?? e.PUBLIC_BASE_URL, token: e.INTERNAL_API_TOKEN }
    : null;

  let access: Config['access'] = null;
  if (!e.AUTH_DISABLED) {
    if (!e.CF_ACCESS_TEAM_DOMAIN || !e.CF_ACCESS_AUD) {
      throw new Error(
        'Faltan CF_ACCESS_TEAM_DOMAIN y CF_ACCESS_AUD. Para desarrollo local usa AUTH_DISABLED=true.',
      );
    }
    access = {
      teamDomain: e.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      aud: e.CF_ACCESS_AUD,
    };
  }

  return {
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    edge,
    access,
  };
}
