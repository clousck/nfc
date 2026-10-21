export interface Env {
  /** slug → LinkRecord (JSON), escrito por el admin vía Cloudflare API. */
  LINKS: KVNamespace;
  /** Tabla `scans`. */
  DB: D1Database;
  /** Desplazamiento horario fijo para agrupar por día/hora en los reportes (Ecuador: -300). */
  REPORT_TZ_OFFSET_MINUTES?: string;
}
