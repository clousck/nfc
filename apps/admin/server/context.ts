import type { LinkStore, ScanStore } from './cloudflare.js';
import type { Db } from './db/client.js';
import type { AuthVariables } from './auth.js';
import type { Services } from './services/index.js';

export interface AppDeps {
  db: Db;
  linkStore: LinkStore;
  /** null si no hay D1 configurada: el panel funciona sin estadísticas. */
  scanStore: ScanStore | null;
  publicBaseUrl: string;
}

/** Lo que reciben las rutas: servicios (reglas) más lo que todavía no tiene servicio propio. */
export type RouteDeps = Services & Pick<AppDeps, 'scanStore' | 'publicBaseUrl'>;

export type AppEnv = { Variables: AuthVariables };
