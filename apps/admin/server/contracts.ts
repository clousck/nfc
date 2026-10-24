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
  /** Claves sobrantes eliminadas. */
  deleted: number;
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
