import { z } from 'zod';
import { LoyaltyVisits } from './loyalty.js';
import { BusinessState, TagState } from './projection.js';
import { BusinessId, DeviceOs, ScanSource, Slug, TargetUrl } from './schemas.js';

// Contrato de la API interna del Worker (`/internal/*`), que solo usa la Pi.
// Ambos lados validan con estos esquemas: lo que la Pi envía y lo que el Worker responde.

export const INTERNAL_PREFIX = '/internal';

/**
 * Orden de los cambios: el Worker ignora un envío cuya revisión no sea mayor que la que ya
 * tiene, así un reintento atrasado nunca pisa un cambio más nuevo.
 */
export const Revision = z.number().int().nonnegative();

export const PutBusinessBody = BusinessState.extend({ revision: Revision });
export type PutBusinessBody = z.infer<typeof PutBusinessBody>;

export const PutTagBody = TagState.extend({ revision: Revision });
export type PutTagBody = z.infer<typeof PutTagBody>;

export const DeleteQuery = z.object({ revision: z.coerce.number().int().nonnegative() });

/** Foto completa del plano de control para "Re-sincronizar todo". */
export const SyncBody = z.object({
  revision: Revision,
  businesses: z.array(BusinessState).max(5_000),
  tags: z.array(TagState).max(20_000),
});
export type SyncBody = z.infer<typeof SyncBody>;

// Ajustes que el negocio puede tocar (dueño: D1). En TagState y BusinessState, `label`,
// `targetUrl` y `loyaltyVisits` son solo la semilla inicial; después se cambian con estas rutas.

export const PutTagSettingsBody = z
  .object({
    targetUrl: TargetUrl.nullable(),
    label: z.string().trim().max(80).nullable(),
    paused: z.boolean(),
  })
  .partial();
export type PutTagSettingsBody = z.infer<typeof PutTagSettingsBody>;

export const TagSettings = z.object({
  slug: Slug,
  businessId: BusinessId,
  targetUrl: TargetUrl.nullable(),
  label: z.string().max(80).nullable(),
  pausedAt: z.number().int().nullable(),
  updatedAt: z.number().int(),
});
export type TagSettings = z.infer<typeof TagSettings>;

export const PutBusinessSettingsBody = z.object({ loyaltyVisits: LoyaltyVisits.nullable() });
export type PutBusinessSettingsBody = z.infer<typeof PutBusinessSettingsBody>;

export const BusinessSettings = z.object({
  businessId: BusinessId,
  loyaltyVisits: LoyaltyVisits.nullable(),
  updatedAt: z.number().int(),
});
export type BusinessSettings = z.infer<typeof BusinessSettings>;

/** Cambios de ajustes desde `since` (incluido), para que la Pi refresque su copia. */
export const SettingsChangesQuery = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
});
export const SettingsChangesResponse = z.object({
  tags: z.array(TagSettings),
  businesses: z.array(BusinessSettings),
});
export type SettingsChangesResponse = z.infer<typeof SettingsChangesResponse>;

export const ApplyResponse = z.object({
  /** false = el Worker ya tenía una revisión igual o más nueva y no cambió nada. */
  applied: z.boolean(),
  /** Escrituras y borrados reales en KV (solo lo que cambió). */
  written: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});
export type ApplyResponse = z.infer<typeof ApplyResponse>;

export const SyncResponse = z.object({
  /** Claves publicadas por tipo tras la sincronización. */
  tags: z.number().int().nonnegative(),
  businesses: z.number().int().nonnegative(),
  reports: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});
export type SyncResponse = z.infer<typeof SyncResponse>;

export const ScanStatsQuery = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  recent: z.coerce.number().int().min(0).max(100).default(20),
});

export const TagScanStatsResponse = z.object({
  since: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative(),
  nfc: z.number().int().nonnegative(),
  qr: z.number().int().nonnegative(),
  ios: z.number().int().nonnegative(),
  android: z.number().int().nonnegative(),
  other: z.number().int().nonnegative(),
  /** Visitas de crawlers (vistas previas de WhatsApp, etc.): no cuentan en el total. */
  bots: z.number().int().nonnegative(),
  lastAt: z.number().int().nullable(),
  recent: z.array(
    z.object({
      ts: z.number().int(),
      source: ScanSource,
      os: DeviceOs.nullable(),
      country: z.string().nullable(),
      city: z.string().nullable(),
    }),
  ),
});
export type TagScanStatsResponse = z.infer<typeof TagScanStatsResponse>;

export const LoyaltyCardsResponse = z.object({
  cards: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      phone: z.string(),
      /** Sellos que cuentan ahora (0 si caducó). */
      stamps: z.number().int().nonnegative(),
      expired: z.boolean(),
      lastVisitAt: z.number().int().nullable(),
      marketing: z.boolean(),
      createdAt: z.number().int(),
      redemptions: z.number().int().nonnegative(),
    }),
  ),
});
export type LoyaltyCardsResponse = z.infer<typeof LoyaltyCardsResponse>;

export const LoyaltyContactsResponse = z.object({
  contacts: z.array(
    z.object({ name: z.string(), phone: z.string(), marketingAt: z.number().int() }),
  ),
});
export type LoyaltyContactsResponse = z.infer<typeof LoyaltyContactsResponse>;

export const DeleteCardResponse = z.object({ deleted: z.boolean() });

export const IncidentsQuery = z.object({
  businessId: z.string().optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});

/** Resumen de incidentes de límite de peticiones (docs/SECURITY.md §4). */
export const RateLimitIncidentsResponse = z.object({
  mode: z.enum(['observe', 'enforce']),
  incidents: z.array(
    z.object({
      /** '' = no se supo a qué negocio iba. */
      businessId: z.string(),
      /** Día local YYYY-MM-DD. */
      day: z.string(),
      action: z.enum(['signup', 'redeem', 'validate', 'login', 'checkin']),
      actor: z.enum(['customer', 'staff', 'anonymous']),
      scope: z.enum(['device', 'network', 'staff', 'login']),
      mode: z.enum(['observe', 'enforce']),
      /** Minutos distintos en los que se superó el límite. */
      minutes: z.number().int().nonnegative(),
      /** Orígenes distintos (un solo origen insistiendo suele ser un script). */
      sources: z.number().int().nonnegative(),
      lastAt: z.number().int(),
    }),
  ),
});
export type RateLimitIncidentsResponse = z.infer<typeof RateLimitIncidentsResponse>;
