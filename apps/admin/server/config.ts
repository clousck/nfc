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

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/admin.db'),
  PUBLIC_BASE_URL: TargetUrl.default('https://go.penginexr.com'),
  CF_ACCOUNT_ID: optionalString,
  CF_API_TOKEN: optionalString,
  CF_KV_LINKS_NAMESPACE_ID: optionalString,
  CF_D1_DATABASE_ID: optionalString,
  CF_ACCESS_TEAM_DOMAIN: optionalString,
  CF_ACCESS_AUD: optionalString,
  AUTH_DISABLED: booleanFlag,
});

export interface Config {
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  cloudflare: {
    accountId: string;
    apiToken: string;
    kvLinksNamespaceId: string;
    /** Opcional: sin él, el panel no muestra escaneos. */
    d1DatabaseId: string | null;
  } | null;
  access: { teamDomain: string; aud: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración inválida:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;

  const cloudflare =
    e.CF_ACCOUNT_ID && e.CF_API_TOKEN && e.CF_KV_LINKS_NAMESPACE_ID
      ? {
          accountId: e.CF_ACCOUNT_ID,
          apiToken: e.CF_API_TOKEN,
          kvLinksNamespaceId: e.CF_KV_LINKS_NAMESPACE_ID,
          d1DatabaseId: e.CF_D1_DATABASE_ID ?? null,
        }
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
    cloudflare,
    access,
  };
}
