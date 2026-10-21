import type { LinkStore, ScanStore } from './cloudflare.js';
import type { Db } from './db/client.js';
import type { AuthVariables } from './auth.js';

export interface AppDeps {
  db: Db;
  linkStore: LinkStore;
  /** null si no hay D1 configurada: el panel funciona sin estadísticas. */
  scanStore: ScanStore | null;
  publicBaseUrl: string;
}

export type AppEnv = { Variables: AuthVariables };
