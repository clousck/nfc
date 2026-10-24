import type { AuthVariables } from './auth.js';
import type { Db } from './db/client.js';
import type { EdgeClient } from './edge-client.js';
import type { Publisher } from './publisher.js';
import type { Services } from './services/index.js';

export interface AppDeps {
  db: Db;
  /** API interna del Worker: único dueño de D1 y único escritor de KV. */
  edge: EdgeClient;
  /** Si no se indica, la app crea uno (sin reintentos en segundo plano). */
  publisher?: Publisher;
  publicBaseUrl: string;
}

/** Lo que reciben las rutas: servicios (reglas) más los clientes que aún no tienen servicio. */
export type RouteDeps = Services & {
  edge: EdgeClient;
  publisher: Publisher;
  publicBaseUrl: string;
};

export type AppEnv = { Variables: AuthVariables };
