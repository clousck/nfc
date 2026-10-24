import { businessKey, generateId, generateReportToken, reportKey } from '@nfc/shared';
import { asc, count, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { LinkStore } from '../cloudflare.js';
import type { SyncResult } from '../contracts.js';
import type { Db } from '../db/client.js';
import { businesses, tags, type Business } from '../db/schema.js';
import { syncBusinesses, toLinkRecord, unpublish } from '../sync.js';
import type { BusinessCreate, BusinessUpdate } from '../validation.js';
import type { TagWithStatus } from './tag-service.js';

export type BusinessCreateInput = z.output<typeof BusinessCreate>;
export type BusinessUpdateInput = z.output<typeof BusinessUpdate>;

export type BusinessResult =
  { ok: true; business: Business; sync: SyncResult } | { ok: false; error: 'not_found' };

export type DeleteBusinessResult =
  { ok: true; sync: SyncResult } | { ok: false; error: 'not_found' | 'has_tags' };

export type BusinessService = ReturnType<typeof createBusinessService>;

/** Negocios: datos comerciales, enlace de estadísticas y su publicación. */
export function createBusinessService({ db, linkStore }: { db: Db; linkStore: LinkStore }) {
  const find = (id: string): Business | null =>
    db.select().from(businesses).where(eq(businesses.id, id)).get() ?? null;

  return {
    find,

    list(): Business[] {
      return db.select().from(businesses).orderBy(desc(businesses.createdAt)).all();
    },

    get(id: string): { business: Business; tags: TagWithStatus[] } | null {
      const business = find(id);
      if (!business) return null;
      const rows = db
        .select()
        .from(tags)
        .where(eq(tags.businessId, id))
        .orderBy(asc(tags.number))
        .all();
      return {
        business,
        tags: rows.map((tag) => ({ tag, published: toLinkRecord(tag, business) !== null })),
      };
    },

    async create(input: BusinessCreateInput): Promise<{ business: Business; sync: SyncResult }> {
      const business = db
        .insert(businesses)
        .values({
          ...input,
          id: generateId('b'),
          reportToken: generateReportToken(),
          createdAt: Date.now(),
        })
        .returning()
        .get();
      // Publica el enlace de estadísticas para que funcione desde el primer momento.
      const sync = await syncBusinesses(db, linkStore, [business.id]);
      return { business, sync };
    },

    async update(id: string, patch: BusinessUpdateInput): Promise<BusinessResult> {
      const business =
        Object.keys(patch).length > 0
          ? db.update(businesses).set(patch).where(eq(businesses.id, id)).returning().get()
          : find(id);
      if (!business) return { ok: false, error: 'not_found' };
      // El estado y el nombre afectan a sus chips y a su enlace de estadísticas.
      const sync = await syncBusinesses(db, linkStore, [id]);
      return { ok: true, business, sync };
    },

    /** Crea o regenera el enlace privado de estadísticas; el anterior deja de funcionar. */
    async regenerateReportToken(id: string): Promise<BusinessResult> {
      const current = find(id);
      if (!current) return { ok: false, error: 'not_found' };
      const business = db
        .update(businesses)
        .set({ reportToken: generateReportToken() })
        .where(eq(businesses.id, id))
        .returning()
        .get();
      if (!business) return { ok: false, error: 'not_found' };
      const removed = current.reportToken
        ? await unpublish(linkStore, [reportKey(current.reportToken)])
        : ({ ok: true } as const);
      const published = await syncBusinesses(db, linkStore, [id]);
      return { ok: true, business, sync: removed.ok ? published : removed };
    },

    async delete(id: string): Promise<DeleteBusinessResult> {
      const [assigned] = db.select({ n: count() }).from(tags).where(eq(tags.businessId, id)).all();
      // Regla: un negocio con chips no se borra; se liberan sus chips o se marca cancelado.
      if (assigned && assigned.n > 0) return { ok: false, error: 'has_tags' };
      const deleted = db.delete(businesses).where(eq(businesses.id, id)).returning().get();
      if (!deleted) return { ok: false, error: 'not_found' };
      const keys = [businessKey(deleted.id)];
      if (deleted.reportToken) keys.push(reportKey(deleted.reportToken));
      return { ok: true, sync: await unpublish(linkStore, keys) };
    },
  };
}
