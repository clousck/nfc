import { z } from 'zod';
import { businessKey, LoyaltyVisits, type BusinessRecord } from './loyalty.js';
import { REPORT_TOKEN_PATTERN, reportKey, type ReportRecord } from './report.js';
import { BusinessId, Slug, TargetUrl, type LinkRecord } from './schemas.js';

// Regla única de "qué se publica en KV" a partir del plano de control (la Pi).
// El Worker la usa para escribir KV; la Pi, para mostrar si un chip está publicado.

/** Estado de un negocio que el plano de datos necesita (copia de la Pi). */
export const BusinessState = z.object({
  id: BusinessId,
  name: z.string().min(1).max(120),
  status: z.enum(['active', 'paused', 'cancelled']),
  reportToken: z.string().regex(REPORT_TOKEN_PATTERN).nullable(),
  loyaltyVisits: LoyaltyVisits.nullable(),
});
export type BusinessState = z.infer<typeof BusinessState>;

/** Estado de un chip que el plano de datos necesita (copia de la Pi). */
export const TagState = z.object({
  slug: Slug,
  number: z.number().int().positive(),
  businessId: BusinessId.nullable(),
  /** Desde cuándo cuentan los escaneos para el negocio actual (epoch ms). */
  assignedAt: z.number().int().nonnegative().nullable(),
  label: z.string().max(80).nullable(),
  type: z.enum(['redirect', 'landing', 'loyalty']),
  targetUrl: TargetUrl.nullable(),
  active: z.boolean(),
});
export type TagState = z.infer<typeof TagState>;

export type KvValue = LinkRecord | ReportRecord | BusinessRecord;

export interface KvEntry {
  key: string;
  value: KvValue;
}

/**
 * Cada clave de KV pertenece a un "dueño": el chip (`tag:<slug>`) o el negocio
 * (`business:<id>`, dueño de `business:<id>` y `report:<token>`). Al cambiar un dueño se
 * recalculan solo sus claves, y las que ya no produce se borran.
 */
export const tagOwner = (slug: string) => `tag:${slug}`;
export const businessOwner = (id: string) => `business:${id}`;

type TagFields = Pick<TagState, 'businessId' | 'type' | 'targetUrl' | 'active'>;
type BusinessFields = Pick<BusinessState, 'id' | 'status'>;

/**
 * Registro de un chip, o `null` si no debe publicarse (chip en inventario o redirect sin
 * destino). Un negocio pausado o cancelado publica `active: false` para que el Worker
 * muestre la página genérica.
 */
export function projectTag(tag: TagFields, business: BusinessFields | null): LinkRecord | null {
  if (!tag.businessId || !business || business.id !== tag.businessId) return null;
  const active = tag.active && business.status === 'active';
  if (tag.type === 'redirect') {
    if (!tag.targetUrl) return null;
    return { type: 'redirect', url: tag.targetUrl, businessId: business.id, active };
  }
  if (tag.type === 'loyalty') {
    return { type: 'loyalty', url: tag.targetUrl, businessId: business.id, active };
  }
  return { type: 'landing', businessId: business.id, active };
}

/** Claves de un negocio: sus datos y, si tiene enlace y no está cancelado, sus estadísticas. */
export function projectBusiness(
  business: BusinessState,
  tags: ReadonlyArray<Pick<TagState, 'slug' | 'number' | 'label' | 'assignedAt' | 'businessId'>>,
): KvEntry[] {
  const entries: KvEntry[] = [
    {
      key: businessKey(business.id),
      value: { name: business.name, loyaltyVisits: business.loyaltyVisits },
    },
  ];
  if (business.reportToken && business.status !== 'cancelled') {
    const own = tags
      .filter((t) => t.businessId === business.id)
      .sort((a, b) => a.number - b.number);
    entries.push({
      key: reportKey(business.reportToken),
      value: {
        businessId: business.id,
        name: business.name,
        tags: own.map((t) => ({
          slug: t.slug,
          number: t.number,
          label: t.label,
          since: t.assignedAt,
        })),
      },
    });
  }
  return entries;
}

/** Estado completo de KV a partir de todo el plano de control: clave → { dueño, valor }. */
export function projectAll(
  businesses: readonly BusinessState[],
  tags: readonly TagState[],
): Map<string, { owner: string; value: KvValue }> {
  const out = new Map<string, { owner: string; value: KvValue }>();
  const byId = new Map(businesses.map((b) => [b.id, b]));
  for (const business of businesses) {
    for (const entry of projectBusiness(business, tags)) {
      out.set(entry.key, { owner: businessOwner(business.id), value: entry.value });
    }
  }
  for (const tag of tags) {
    const record = projectTag(tag, tag.businessId ? (byId.get(tag.businessId) ?? null) : null);
    if (record) out.set(tag.slug, { owner: tagOwner(tag.slug), value: record });
  }
  return out;
}
