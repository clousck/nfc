import { asc, eq, inArray } from 'drizzle-orm';
import {
  businessKey,
  reportKey,
  type BusinessRecord,
  type LinkRecord,
  type ReportRecord,
} from '@nfc/shared';
import type { KvEntry, LinkStore } from './cloudflare.js';
import type { SyncResult } from './contracts.js';
import type { Db } from './db/client.js';
import { businesses, tags, type Business, type Tag } from './db/schema.js';

export type { SyncResult };

export interface ResyncResult {
  /** Total de claves escritas en KV (chips + negocios + enlaces de estadísticas). */
  published: number;
  tags: number;
  businesses: number;
  reports: number;
  deleted: number;
}

/**
 * Registro que debe existir en KV para un chip, o `null` si no debe publicarse
 * (chip en inventario o redirect sin destino). Un negocio pausado o cancelado
 * publica `active: false` para que el Worker muestre la página genérica.
 */
export function toLinkRecord(tag: Tag, business: Business | null): LinkRecord | null {
  if (!tag.businessId || !business) return null;
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

/** Datos del negocio que el Worker necesita para las páginas de fidelidad. */
export function toBusinessRecord(business: Business): BusinessRecord {
  return { name: business.name, loyaltyVisits: business.loyaltyVisits };
}

/** Datos del enlace de estadísticas, o `null` si no debe publicarse (sin token o cancelado). */
export function toReportRecord(business: Business, businessTags: Tag[]): ReportRecord | null {
  if (!business.reportToken || business.status === 'cancelled') return null;
  return {
    businessId: business.id,
    name: business.name,
    tags: businessTags.map((t) => ({
      slug: t.slug,
      number: t.number,
      label: t.label,
      since: t.assignedAt,
    })),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadTagsWithBusiness(db: Db, slugs?: readonly string[]) {
  const query = db
    .select({ tag: tags, business: businesses })
    .from(tags)
    .leftJoin(businesses, eq(tags.businessId, businesses.id));
  return (slugs ? query.where(inArray(tags.slug, [...slugs])) : query).all();
}

function tagsOf(db: Db, businessId: string): Tag[] {
  return db
    .select()
    .from(tags)
    .where(eq(tags.businessId, businessId))
    .orderBy(asc(tags.number))
    .all();
}

/** Entradas de KV (chips y enlace) que dependen de los negocios indicados. */
function businessEntries(db: Db, businessIds: readonly string[]) {
  const toPut: KvEntry[] = [];
  const toDelete: string[] = [];
  const slugs: string[] = [];
  const rows = db
    .select()
    .from(businesses)
    .where(inArray(businesses.id, [...businessIds]))
    .all();
  for (const business of rows) {
    const businessTags = tagsOf(db, business.id);
    toPut.push({ key: businessKey(business.id), value: toBusinessRecord(business) });
    if (business.reportToken) {
      const report = toReportRecord(business, businessTags);
      if (report) toPut.push({ key: reportKey(business.reportToken), value: report });
      else toDelete.push(reportKey(business.reportToken));
    }
    for (const tag of businessTags) {
      slugs.push(tag.slug);
      const record = toLinkRecord(tag, business);
      if (record) toPut.push({ key: tag.slug, value: record });
      else toDelete.push(tag.slug);
    }
  }
  return { toPut, toDelete, slugs };
}

async function publish(
  db: Db,
  store: LinkStore,
  toPut: KvEntry[],
  toDelete: string[],
  syncedSlugs: string[],
): Promise<SyncResult> {
  try {
    if (toPut.length > 0) await store.putMany(toPut);
    if (toDelete.length > 0) await store.deleteMany(toDelete);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (syncedSlugs.length > 0) {
    db.update(tags).set({ syncedAt: Date.now() }).where(inArray(tags.slug, syncedSlugs)).run();
  }
  return { ok: true };
}

/**
 * Publica en KV los chips indicados y el enlace de estadísticas de los negocios
 * afectados (incluidos los que acaban de perder un chip). No lanza.
 */
export async function syncTags(
  db: Db,
  store: LinkStore,
  slugs: readonly string[],
  alsoBusinessIds: readonly (string | null | undefined)[] = [],
): Promise<SyncResult> {
  const toPut: KvEntry[] = [];
  const toDelete: string[] = [];
  const synced = new Set<string>();
  const affected = new Set(alsoBusinessIds.filter((id): id is string => !!id));

  for (const { tag, business } of slugs.length > 0 ? loadTagsWithBusiness(db, slugs) : []) {
    synced.add(tag.slug);
    if (business) {
      affected.add(business.id);
      continue; // se publica junto con su negocio
    }
    toDelete.push(tag.slug); // chip libre: no debe estar en KV
  }

  if (affected.size > 0) {
    const entries = businessEntries(db, [...affected]);
    toPut.push(...entries.toPut);
    toDelete.push(...entries.toDelete);
    for (const slug of entries.slugs) synced.add(slug);
  }

  if (toPut.length === 0 && toDelete.length === 0) return { ok: true };
  return publish(db, store, toPut, toDelete, [...synced]);
}

export async function syncBusinesses(
  db: Db,
  store: LinkStore,
  businessIds: readonly string[],
): Promise<SyncResult> {
  return syncTags(db, store, [], businessIds);
}

/** Elimina claves de KV que ya no existen en SQLite (chip borrado, enlace regenerado…). */
export async function unpublish(store: LinkStore, keys: readonly string[]): Promise<SyncResult> {
  try {
    await store.deleteMany(keys);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Re-sincronizar todo": reescribe KV completo desde SQLite y borra las claves
 * que ya no corresponden a ningún chip ni enlace publicable. Lanza si la API falla.
 */
export async function resyncAll(db: Db, store: LinkStore): Promise<ResyncResult> {
  const tagEntries: KvEntry[] = [];
  for (const { tag, business } of loadTagsWithBusiness(db)) {
    const record = toLinkRecord(tag, business);
    if (record) tagEntries.push({ key: tag.slug, value: record });
  }
  const allBusinesses = db.select().from(businesses).all();
  const businessEntries = allBusinesses.map((business) => ({
    key: businessKey(business.id),
    value: toBusinessRecord(business),
  }));
  const reportEntries: KvEntry[] = [];
  for (const business of allBusinesses) {
    const report = toReportRecord(business, tagsOf(db, business.id));
    if (report && business.reportToken) {
      reportEntries.push({ key: reportKey(business.reportToken), value: report });
    }
  }
  const toPut = [...tagEntries, ...businessEntries, ...reportEntries];
  await store.putMany(toPut);

  const published = new Set(toPut.map((entry) => entry.key));
  const orphans = (await store.listKeys()).filter((key) => !published.has(key));
  if (orphans.length > 0) await store.deleteMany(orphans);

  db.update(tags).set({ syncedAt: Date.now() }).run();
  return {
    published: toPut.length,
    tags: tagEntries.length,
    businesses: businessEntries.length,
    reports: reportEntries.length,
    deleted: orphans.length,
  };
}
