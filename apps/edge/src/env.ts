export interface Env {
  /** slug → LinkRecord (JSON) y registros de negocio/reporte. Solo lo escribe /internal. */
  LINKS: KVNamespace;
  /** Escaneos, fidelidad y copia del plano de control (único dueño: este Worker). */
  DB: D1Database;
  /** Desplazamiento horario fijo para agrupar por día/hora en los reportes (Ecuador: -300). */
  REPORT_TZ_OFFSET_MINUTES?: string;
  /** Secreto compartido con la Pi para /internal/* (wrangler secret). Sin él, /internal queda cerrado. */
  INTERNAL_API_TOKEN?: string;
  /** Origen del portal de negocios (enlaces de acceso). Por defecto https://negocios.penginexr.com. */
  PORTAL_ORIGIN?: string;
  /** observe | enforce (ver wrangler.toml). */
  RATE_LIMIT_MODE?: string;
  RL_DEVICE: RateLimit;
  RL_NETWORK: RateLimit;
  RL_STAFF: RateLimit;
  RL_INCIDENT_LOG: RateLimit;
  RL_LOGIN: RateLimit;
  /** Clave de Resend para enviar los enlaces de acceso (wrangler secret). */
  RESEND_API_KEY?: string;
  /** Remitente de los correos, p. ej. "PengineXR <acceso@penginexr.com>". */
  MAIL_FROM?: string;
  /** A quién avisar de un stand perdido, por defecto (el panel puede cambiarlo: app_settings). */
  ADMIN_NOTIFY_EMAIL?: string;
  /** Origen público de los chips (enlaces de vinculación). Por defecto https://go.penginexr.com. */
  PUBLIC_ORIGIN?: string;
  /** Solo desarrollo (.dev.vars): sin RESEND_API_KEY, escribe el correo en la consola. */
  MAIL_DEV_LOG?: string;
}
