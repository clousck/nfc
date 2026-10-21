import type { LinkStore } from './cloudflare.js';
import type { Db } from './db/client.js';
import type { AuthVariables } from './auth.js';

export interface AppDeps {
  db: Db;
  linkStore: LinkStore;
  publicBaseUrl: string;
}

export type AppEnv = { Variables: AuthVariables };
