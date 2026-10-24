// Contrato de la API del panel: lo que el servidor promete devolver y lo que importa la UI.
// Solo tipos y sin imports, para no arrastrar la base de datos ni Node al bundle del navegador.
// Una columna nueva en la base NO aparece en la API hasta que se añade aquí y en presenters.ts.

export type SyncResult = { ok: true } | { ok: false; error: string };

export type BusinessPlan = 'basic' | 'premium';
export type BusinessStatus = 'active' | 'paused' | 'cancelled';
export type TagType = 'redirect' | 'landing' | 'loyalty';

export interface BusinessDto {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  plan: BusinessPlan;
  status: BusinessStatus;
  notes: string | null;
  /** Visitas para el premio; null = programa de fidelidad desactivado. */
  loyaltyVisits: number | null;
  reportToken: string | null;
  /** Enlace privado de estadísticas (go.penginexr.com/r/<token>); null = sin enlace. */
  reportUrl: string | null;
  createdAt: number;
}

export interface TagDto {
  slug: string;
  /** Número correlativo visible (#1, #2…). */
  number: number;
  /** null = chip libre en inventario. */
  businessId: string | null;
  /** Desde cuándo cuentan las estadísticas para el negocio actual. */
  assignedAt: number | null;
  label: string | null;
  type: TagType;
  targetUrl: string | null;
  active: boolean;
  lockedAt: number | null;
  /** El negocio lo pausó ("stand perdido"): no funciona hasta reactivarlo. */
  pausedAt: number | null;
  syncedAt: number | null;
  createdAt: number;
  urls: { nfc: string; qr: string };
  /** Si el chip debe estar publicado en Cloudflare con su estado actual. */
  published: boolean;
}

export interface BusinessDetailDto extends BusinessDto {
  tags: TagDto[];
}

export type WithSync<T> = T & { sync: SyncResult };

export interface ResyncDto {
  ok: true;
  /** Total de claves escritas en KV. */
  published: number;
  /** Chips publicados (los libres o sin destino no se publican). */
  tags: number;
  /** Registros `business:<id>` (nombre y visitas del premio). */
  businesses: number;
  /** Enlaces de estadísticas `report:<token>`. */
  reports: number;
  /** Escrituras reales en KV (solo lo que cambió). */
  written: number;
  /** Claves sobrantes eliminadas. */
  deleted: number;
}

/** Cambios guardados que aún no llegaron al Worker (se reintentan solos). */
export interface PublishStatusDto {
  pending: number;
  failing: number;
  lastError: string | null;
  nextAttemptAt: number | null;
}

export interface RecentScanDto {
  ts: number;
  source: 'nfc' | 'qr';
  os: 'ios' | 'android' | 'other' | null;
  country: string | null;
  city: string | null;
}

export interface TagScanStats {
  /** Desde cuándo se cuenta (asignación al negocio actual); null = desde siempre. */
  since: number | null;
  total: number;
  nfc: number;
  qr: number;
  ios: number;
  android: number;
  other: number;
  /** Visitas de crawlers (vistas previas de WhatsApp, etc.): no cuentan en el total. */
  bots: number;
  lastAt: number | null;
  recent: RecentScanDto[];
}

export interface RateLimitIncidentDto {
  businessId: string | null;
  /** Nombre del negocio, o null si no se supo a cuál iba la petición. */
  businessName: string | null;
  /** Día local YYYY-MM-DD. */
  day: string;
  action: 'signup' | 'redeem' | 'validate';
  actor: 'customer' | 'staff' | 'anonymous';
  scope: 'device' | 'network' | 'staff';
  mode: 'observe' | 'enforce';
  /** Minutos distintos en los que se superó el límite. */
  minutes: number;
  /** Orígenes distintos. */
  sources: number;
  lastAt: number;
}

export interface RateLimitIncidentsDto {
  /** observe = solo se registra; enforce = se bloquea. */
  mode: 'observe' | 'enforce';
  days: number;
  incidents: RateLimitIncidentDto[];
}

export interface LoyaltyCardDto {
  id: number;
  name: string;
  phone: string;
  stamps: number;
  expired: boolean;
  lastVisitAt: number | null;
  marketing: boolean;
  createdAt: number;
  redemptions: number;
}

export interface LoyaltyDto {
  visits: number | null;
  cards: LoyaltyCardDto[];
}

/** Cuenta de un dueño con acceso al portal del negocio (vive en D1). */
export interface AccountDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
  /** Último acceso al portal; null = nunca entró. */
  lastLoginAt: number | null;
}

export interface AccountsDto {
  accounts: AccountDto[];
}

/** Enlace de acceso de un solo uso para enviar al dueño (caduca en 24 h). */
export interface LoginLinkDto {
  url: string;
  expiresAt: number;
}
