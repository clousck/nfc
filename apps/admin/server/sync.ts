import { eq, inArray } from 'drizzle-orm';
import type { LinkRecord } from '@nfc/shared';
import type { LinkStore } from './cloudflare.js';
import type { Db } from './db/client.js';
import { businesses, tags, type Business, type Tag } from './db/schema.js';

export type SyncResult = { ok: true } | { ok: false; error: string };

export interface ResyncResult {
  published: number;
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
  return { type: 'landing', businessId: business.id, active };
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

/** Publica en KV el estado actual de los chips indicados. No lanza: devuelve el resultado. */
export async function syncTags(
  db: Db,
  store: LinkStore,
  slugs: readonly string[],
): Promise<SyncResult> {
  if (slugs.length === 0) return { ok: true };
  const rows = loadTagsWithBusiness(db, slugs);
  const toPut: Array<{ slug: string; record: LinkRecord }> = [];
  const toDelete: string[] = [];
  for (const { tag, business } of rows) {
    const record = toLinkRecord(tag, business);
    if (record) toPut.push({ slug: tag.slug, record });
    else toDelete.push(tag.slug);
  }
  try {
    if (toPut.length > 0) await store.putMany(toPut);
    if (toDelete.length > 0) await store.deleteMany(toDelete);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  db.update(tags)
    .set({ syncedAt: Date.now() })
    .where(inArray(tags.slug, [...slugs]))
    .run();
  return { ok: true };
}

export async function syncBusinessTags(
  db: Db,
  store: LinkStore,
  businessId: string,
): Promise<SyncResult> {
  const slugs = db
    .select({ slug: tags.slug })
    .from(tags)
    .where(eq(tags.businessId, businessId))
    .all()
    .map((row) => row.slug);
  return syncTags(db, store, slugs);
}

/** Elimina un chip de KV (el registro ya no existe en SQLite). */
export async function unpublishTag(store: LinkStore, slug: string): Promise<SyncResult> {
  try {
    await store.deleteMany([slug]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Re-sincronizar todo": reescribe KV completo desde SQLite y borra las claves
 * que ya no corresponden a ningún chip publicable. Lanza si la API falla.
 */
export async function resyncAll(db: Db, store: LinkStore): Promise<ResyncResult> {
  const rows = loadTagsWithBusiness(db);
  const toPut: Array<{ slug: string; record: LinkRecord }> = [];
  for (const { tag, business } of rows) {
    const record = toLinkRecord(tag, business);
    if (record) toPut.push({ slug: tag.slug, record });
  }
  await store.putMany(toPut);

  const published = new Set(toPut.map((entry) => entry.slug));
  const orphans = (await store.listSlugs()).filter((slug) => !published.has(slug));
  if (orphans.length > 0) await store.deleteMany(orphans);

  db.update(tags).set({ syncedAt: Date.now() }).run();
  return { published: toPut.length, deleted: orphans.length };
}
