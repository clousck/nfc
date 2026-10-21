export interface Env {
  /** slug → LinkRecord (JSON), escrito por el admin vía Cloudflare API. */
  LINKS: KVNamespace;
  /** Tabla `scans`. */
  DB: D1Database;
}
