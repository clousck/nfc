export interface Env {
  /** slug → LinkRecord (JSON) y registros de negocio/reporte. Solo lo escribe /internal. */
  LINKS: KVNamespace;
  /** Escaneos, fidelidad y copia del plano de control (único dueño: este Worker). */
  DB: D1Database;
  /** Desplazamiento horario fijo para agrupar por día/hora en los reportes (Ecuador: -300). */
  REPORT_TZ_OFFSET_MINUTES?: string;
  /** Secreto compartido con la Pi para /internal/* (wrangler secret). Sin él, /internal queda cerrado. */
  INTERNAL_API_TOKEN?: string;
  /** observe | enforce (ver wrangler.toml). */
  RATE_LIMIT_MODE?: string;
  RL_DEVICE: RateLimit;
  RL_NETWORK: RateLimit;
  RL_STAFF: RateLimit;
  RL_INCIDENT_LOG: RateLimit;
}
